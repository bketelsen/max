import { classifyAuthRedirectResponse } from "@/lib/connectivity";

// Fetch-based Server-Sent Events reader.
// EventSource can't send an Authorization header, so we parse the stream manually.
// Only handles the subset of SSE that Max emits: `data: ...\n\n` frames and
// `:keepalive` comment lines.

export type SseEvent = { data: string };

export class SseAuthExpiredError extends Error {
  constructor() {
    super("SSE authentication expired");
    this.name = "SseAuthExpiredError";
  }
}

export async function openSseStream(
  url: string,
  init: RequestInit,
  onEvent: (evt: SseEvent) => void,
  onActivity?: () => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, { ...init, redirect: "manual", signal });
  if (classifyAuthRedirectResponse(res) === "auth-expired") {
    throw new SseAuthExpiredError();
  }
  if (!res.ok || !res.body) {
    throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          }
        }
        if (dataLines.length > 0) {
          onEvent({ data: dataLines.join("\n") });
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader may already be released if the stream errored
    }
  }
}
