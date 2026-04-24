import { createMessageId, type UIMessage } from "./chat-types.ts";

export const HYDRATED_MESSAGE_LIMIT = 50;

export function createSystemMessage(text: string): UIMessage {
  return {
    id: createMessageId(),
    role: "system",
    text,
  };
}

export function appendSystemMessage(
  messages: UIMessage[],
  text: string
): UIMessage[] {
  return [...messages, createSystemMessage(text)];
}
