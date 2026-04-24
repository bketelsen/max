import { HYDRATED_MESSAGE_LIMIT } from "./chat-messages.ts";
import type { UIMessage } from "./chat-types.ts";

export function resolveRestoredMessages({
  cachedMessages,
  historyMessages,
}: {
  cachedMessages: UIMessage[];
  historyMessages: UIMessage[];
}): UIMessage[] {
  const normalizedHistory = historyMessages.slice(-HYDRATED_MESSAGE_LIMIT);

  if (normalizedHistory.length > 0) {
    return normalizedHistory;
  }

  return cachedMessages.slice(-HYDRATED_MESSAGE_LIMIT);
}
