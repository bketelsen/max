type ErrorWithCause = Error & {
  cause?: unknown;
  stderr?: string;
  error?: unknown;
  lastError?: unknown;
  errors?: unknown[];
};

export interface CopilotErrorDetails {
  userMessage: string;
  logMessage: string;
}

function cleanMessage(message: string): string {
  return message.replace(/(?:^|\s)Error:\s*/g, "$1").replace(/\s+/g, " ").trim();
}

function isMeaningfulMessage(message: string): boolean {
  const cleaned = cleanMessage(message);
  if (!cleaned) return false;
  return !/^unknown error$/i.test(cleaned);
}

function collectMessages(err: unknown, seen = new Set<unknown>(), messages: string[] = []): string[] {
  if (err === null || err === undefined || seen.has(err)) return messages;
  if (typeof err === "object" || typeof err === "function") seen.add(err);

  if (typeof err === "string") {
    if (err.trim()) messages.push(cleanMessage(err));
    return messages;
  }

  if (err instanceof Error) {
    if (err.message.trim()) messages.push(cleanMessage(err.message));
  } else if (typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      messages.push(cleanMessage(record.message));
    }
  }

  if (typeof err === "object" && err !== null) {
    const error = err as ErrorWithCause;
    if (typeof error.stderr === "string" && error.stderr.trim()) {
      messages.push(cleanMessage(error.stderr));
    }
    collectMessages(error.cause, seen, messages);
    collectMessages(error.error, seen, messages);
    collectMessages(error.lastError, seen, messages);
    if (Array.isArray(error.errors)) {
      for (const nested of error.errors) {
        collectMessages(nested, seen, messages);
      }
    }
  }

  return messages;
}

function summarizePrimaryMessage(message: string): string {
  let summary = cleanMessage(message);

  summary = summary.replace(
    /Failed to get response from the AI model; retried \d+ times \(total retry wait time: [^)]+\)/i,
    "Failed to get response from the AI model after retries"
  );
  summary = summary.replace(/\s*Last error:\s*Unknown error/i, "");

  return summary.trim() || "Unknown error";
}

export function describeCopilotError(err: unknown): CopilotErrorDetails {
  const chain = collectMessages(err).filter(Boolean);
  const primary = summarizePrimaryMessage(chain[0] || String(err));
  const rootCause = [...chain]
    .reverse()
    .find((message) => isMeaningfulMessage(message) && cleanMessage(message) !== primary);

  const userMessage =
    rootCause && /unknown error|failed to get response from the ai model/i.test(primary)
      ? `${primary}. Root cause: ${rootCause}`
      : primary;

  const uniqueChain = Array.from(new Set([primary, ...chain.filter((message) => cleanMessage(message) !== primary)]));
  const logMessage =
    rootCause && !uniqueChain.some((message) => message === `Root cause: ${rootCause}`)
      ? `${userMessage} | Error chain: ${uniqueChain.join(" <- ")}`
      : userMessage;

  return { userMessage, logMessage };
}

export function isRecoverableCopilotError(err: unknown): boolean {
  const messages = collectMessages(err);
  if (messages.some((message) => /timeout|timed?\s*out/i.test(message))) {
    return false;
  }

  return messages.some((message) =>
    /disconnect|connection|EPIPE|ECONNRESET|ECONNREFUSED|socket|closed|ENOENT|spawn|not found|expired|stale|missing finish_reason|stream/i.test(message)
  );
}
