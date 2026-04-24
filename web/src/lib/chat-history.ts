import { HYDRATED_MESSAGE_LIMIT } from "./chat-messages.ts";
import type { UIMessage } from "./chat-types.ts";

export function resolveRestoredMessages({
  historyMessages,
}: {
  cachedMessages: UIMessage[];
  historyMessages: UIMessage[];
}): UIMessage[] {
  return historyMessages.slice(-HYDRATED_MESSAGE_LIMIT);
}
