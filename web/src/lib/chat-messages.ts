import { createMessageId, type RouteInfo, type UIMessage } from "./chat-types.ts";

export const DEFAULT_CHAT_SCOPE = "default";
export const DEFAULT_CHAT_STORAGE_KEY = `max_chat:${DEFAULT_CHAT_SCOPE}`;
export const MESSAGES_STORAGE_MIGRATION_FLAG = "max_chat_migrated_v1";
export const LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY = "max.web.messages";
export const LEGACY_MESSAGES_STORAGE_KEY = "max.web.system-messages";
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

export function serializeMessages(messages: UIMessage[]): string {
  return JSON.stringify(
    messages
      .filter((message) => isPersistableMessage(message))
      .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      ...(message.route ? { route: message.route } : {}),
      ...(message.proactive ? { proactive: true } : {}),
      }))
  );
}

export function parseStoredMessages(
  raw: string | null,
  limit?: number
): UIMessage[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const messages = parsed.flatMap(parseStoredMessage);

    if (limit === undefined) {
      return messages;
    }

    return messages.slice(-Math.max(limit, 0));
  } catch {
    return [];
  }
}

export function getChatStorageKey(scope = DEFAULT_CHAT_SCOPE): string {
  return `max_chat:${scope}`;
}

export function migrateScopedMessagesStorage(
  storage: Storage,
  scope = DEFAULT_CHAT_SCOPE
): string | null {
  const scopedKey = getChatStorageKey(scope);
  const scopedData = storage.getItem(scopedKey);

  if (storage.getItem(MESSAGES_STORAGE_MIGRATION_FLAG)) {
    return scopedData;
  }

  const legacyData =
    storage.getItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY) ??
    storage.getItem(LEGACY_MESSAGES_STORAGE_KEY);

  if (scopedData === null && legacyData !== null) {
    storage.setItem(scopedKey, legacyData);
  }

  if (legacyData !== null) {
    storage.removeItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY);
    storage.removeItem(LEGACY_MESSAGES_STORAGE_KEY);
  }

  storage.setItem(MESSAGES_STORAGE_MIGRATION_FLAG, "true");

  return storage.getItem(scopedKey) ?? legacyData;
}

export function loadStoredMessages(
  storage: Storage,
  limit = HYDRATED_MESSAGE_LIMIT,
  scope = DEFAULT_CHAT_SCOPE
): UIMessage[] {
  return parseStoredMessages(migrateScopedMessagesStorage(storage, scope), limit);
}

export function persistMessages(
  storage: Storage,
  messages: UIMessage[],
  scope = DEFAULT_CHAT_SCOPE
): void {
  const scopedKey = getChatStorageKey(scope);
  const serialized = serializeMessages(messages);
  const storedMessages = parseStoredMessages(serialized);

  if (storedMessages.length === 0) {
    storage.removeItem(scopedKey);
  } else {
    storage.setItem(scopedKey, serialized);
  }

  storage.removeItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY);
  storage.removeItem(LEGACY_MESSAGES_STORAGE_KEY);
}

function parseStoredMessage(message: unknown): UIMessage[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  const candidate = message as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.text !== "string" ||
    (candidate.role !== "user" &&
      candidate.role !== "assistant" &&
      candidate.role !== "system")
  ) {
    return [];
  }

  return [
    {
      id: candidate.id,
      role: candidate.role,
      text: candidate.text,
      ...(typeof candidate.proactive === "boolean"
        ? { proactive: candidate.proactive }
        : {}),
      ...(candidate.route ? parseStoredRoute(candidate.route) : {}),
    },
  ];
}

function isPersistableMessage(message: UIMessage): boolean {
  if (message.proactive) {
    return false;
  }

  if (message.role === "assistant" && message.text.length === 0) {
    return false;
  }

  return true;
}

function parseStoredRoute(route: unknown): { route: RouteInfo } | Record<string, never> {
  if (!route || typeof route !== "object") {
    return {};
  }

  const candidate = route as Record<string, unknown>;
  if (
    typeof candidate.model !== "string" ||
    (candidate.routerMode !== "auto" && candidate.routerMode !== "manual")
  ) {
    return {};
  }

  if (
    ("tier" in candidate &&
      candidate.tier !== undefined &&
      candidate.tier !== null &&
      typeof candidate.tier !== "string") ||
    ("overrideName" in candidate &&
      candidate.overrideName !== undefined &&
      typeof candidate.overrideName !== "string")
  ) {
    return {};
  }

  return {
    route: {
      model: candidate.model,
      routerMode: candidate.routerMode,
      ...(candidate.tier === undefined ? {} : { tier: candidate.tier }),
      ...(candidate.overrideName === undefined
        ? {}
        : { overrideName: candidate.overrideName }),
    },
  };
}
