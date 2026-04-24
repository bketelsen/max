import { HYDRATED_MESSAGE_LIMIT } from "./chat-messages.ts";
import type { UIMessage } from "./chat-types.ts";

export function resolveRestoredMessages({
  cachedMessages,
  historyMessages,
}: {
  cachedMessages: UIMessage[];
  historyMessages: UIMessage[];
}): UIMessage[] {
  const normalizedCache = cachedMessages.slice(-HYDRATED_MESSAGE_LIMIT);
  const normalizedHistory = historyMessages.slice(-HYDRATED_MESSAGE_LIMIT);

  if (normalizedHistory.length === 0) {
    return normalizedCache;
  }

  if (normalizedCache.length === 0) {
    return normalizedHistory;
  }

  if (messageSequencesMatch(normalizedCache, normalizedHistory)) {
    return normalizedCache;
  }

  if (isMessagePrefix(normalizedHistory, normalizedCache)) {
    return normalizedCache;
  }

  if (isMessagePrefix(normalizedCache, normalizedHistory)) {
    return [
      ...normalizedCache,
      ...normalizedHistory.slice(normalizedCache.length),
    ].slice(-HYDRATED_MESSAGE_LIMIT);
  }

  const cachedThenHistory = mergeMessageWindows(normalizedCache, normalizedHistory);
  const historyThenCached = mergeMessageWindows(normalizedHistory, normalizedCache);

  const bestCandidate =
    cachedThenHistory.overlap === 0 && historyThenCached.overlap === 0
      ? normalizedHistory
      : pickBetterMergeCandidate(cachedThenHistory, historyThenCached);

  const mergedMessages = bestCandidate.slice(-HYDRATED_MESSAGE_LIMIT);

  return messageSequencesMatch(mergedMessages, normalizedCache)
    ? normalizedCache
    : mergedMessages;
}

function pickBetterMergeCandidate(
  first: { messages: UIMessage[]; overlap: number },
  second: { messages: UIMessage[]; overlap: number }
): UIMessage[] {
  if (first.overlap !== second.overlap) {
    return first.overlap > second.overlap ? first.messages : second.messages;
  }

  if (first.messages.length !== second.messages.length) {
    return first.messages.length < second.messages.length ? first.messages : second.messages;
  }

  return first.messages;
}

function mergeMessageWindows(
  leading: UIMessage[],
  trailing: UIMessage[]
): { messages: UIMessage[]; overlap: number } {
  const overlap = getWindowOverlap(leading, trailing);

  return {
    messages: [...leading, ...trailing.slice(overlap)],
    overlap,
  };
}

function getWindowOverlap(leading: UIMessage[], trailing: UIMessage[]): number {
  const maxOverlap = Math.min(leading.length, trailing.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const leadingSlice = leading.slice(-size);
    const trailingSlice = trailing.slice(0, size);

    if (leadingSlice.every((message, index) => messagesMatch(message, trailingSlice[index]))) {
      return size;
    }
  }

  return 0;
}

function messagesMatch(left: UIMessage, right: UIMessage): boolean {
  return (
    left.role === right.role &&
    left.text === right.text &&
    left.proactive === right.proactive &&
    routesMatch(left.route, right.route)
  );
}

function isMessagePrefix(prefix: UIMessage[], messages: UIMessage[]): boolean {
  if (prefix.length > messages.length) {
    return false;
  }

  return prefix.every((message, index) => messagesMatch(message, messages[index]));
}

function messageSequencesMatch(left: UIMessage[], right: UIMessage[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) => messagesMatch(message, right[index]));
}

function routesMatch(left?: UIMessage["route"], right?: UIMessage["route"]): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.model === right.model &&
    left.routerMode === right.routerMode &&
    left.tier === right.tier &&
    left.overrideName === right.overrideName
  );
}
