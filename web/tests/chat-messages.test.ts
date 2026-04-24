import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendSystemMessage,
  createSystemMessage,
  DEFAULT_CHAT_STORAGE_KEY,
  HYDRATED_MESSAGE_LIMIT,
  LEGACY_MESSAGES_STORAGE_KEY,
  LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY,
  MESSAGES_STORAGE_MIGRATION_FLAG,
  loadStoredMessages,
  migrateScopedMessagesStorage,
  persistMessages,
  parseStoredMessages,
  serializeMessages,
} from "../src/lib/chat-messages.ts";
import type { UIMessage } from "../src/lib/chat-types.ts";

test("createSystemMessage creates a system-role message", () => {
  const message = createSystemMessage("Slash commands are ready");

  assert.equal(message.role, "system");
  assert.equal(message.text, "Slash commands are ready");
  assert.ok(message.id);
});

test("appendSystemMessage appends a new system message", () => {
  const existing: UIMessage[] = [{ id: "1", role: "user", text: "hello" }];

  const next = appendSystemMessage(existing, "All done");

  assert.notEqual(next, existing);
  assert.equal(next.length, 2);
  assert.equal(next.at(-1)?.role, "system");
  assert.equal(next.at(-1)?.text, "All done");
});

test("chat message persistence stores the full history", () => {
  const messages: UIMessage[] = [
    { id: "1", role: "user", text: "hello" },
    { id: "2", role: "assistant", text: "hi" },
    { id: "3", role: "system", text: "auto on" },
  ];

  const serialized = serializeMessages(messages);
  const restored = parseStoredMessages(serialized);

  assert.deepEqual(restored, messages);
});

test("chat message persistence skips proactive messages and empty assistant placeholders", () => {
  const messages: UIMessage[] = [
    { id: "1", role: "user", text: "hello" },
    { id: "2", role: "assistant", text: "" },
    { id: "3", role: "assistant", text: "useful partial ⚠️ [connection lost]" },
    { id: "4", role: "assistant", text: "background note", proactive: true },
  ];

  const restored = parseStoredMessages(serializeMessages(messages));

  assert.deepEqual(restored, [
    { id: "1", role: "user", text: "hello" },
    { id: "3", role: "assistant", text: "useful partial ⚠️ [connection lost]" },
  ]);
});

test("chat message hydration restores only the latest 50 messages", () => {
  assert.equal(HYDRATED_MESSAGE_LIMIT, 50);

  const messages = Array.from({ length: HYDRATED_MESSAGE_LIMIT + 5 }, (_, index) => ({
    id: String(index + 1),
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: `message ${index + 1}`,
  }));

  const hydrated = parseStoredMessages(serializeMessages(messages), HYDRATED_MESSAGE_LIMIT);

  assert.equal(hydrated.length, HYDRATED_MESSAGE_LIMIT);
  assert.equal(hydrated[0]?.id, "6");
  assert.equal(hydrated.at(-1)?.id, String(messages.length));
});

test("chat storage migration moves the legacy conversation into the default scoped key", () => {
  const storage = createStorageStub();
  const legacyMessages: UIMessage[] = [
    { id: "1", role: "user", text: "hello" },
    { id: "2", role: "assistant", text: "hi there" },
  ];

  storage.setItem(
    LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY,
    serializeMessages(legacyMessages)
  );

  const migrated = migrateScopedMessagesStorage(storage);

  assert.equal(migrated, serializeMessages(legacyMessages));
  assert.equal(
    storage.getItem(DEFAULT_CHAT_STORAGE_KEY),
    serializeMessages(legacyMessages)
  );
  assert.equal(storage.getItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_MESSAGES_STORAGE_KEY), null);
  assert.equal(storage.getItem(MESSAGES_STORAGE_MIGRATION_FLAG), "true");
});

test("chat storage migration runs only once and keeps the scoped conversation", () => {
  const storage = createStorageStub();
  const scopedMessages: UIMessage[] = [{ id: "2", role: "assistant", text: "new" }];

  storage.setItem(DEFAULT_CHAT_STORAGE_KEY, serializeMessages(scopedMessages));
  storage.setItem(
    LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY,
    serializeMessages([{ id: "1", role: "user", text: "old" }])
  );
  storage.setItem(MESSAGES_STORAGE_MIGRATION_FLAG, "true");

  const loaded = loadStoredMessages(storage);

  assert.deepEqual(loaded, scopedMessages);
  assert.equal(
    storage.getItem(DEFAULT_CHAT_STORAGE_KEY),
    serializeMessages(scopedMessages)
  );
  assert.notEqual(storage.getItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY), null);
});

test("chat persistence writes to the default scoped key and removes legacy keys", () => {
  const storage = createStorageStub();
  const messages: UIMessage[] = [
    { id: "1", role: "user", text: "hello" },
    { id: "2", role: "assistant", text: "hi" },
  ];

  storage.setItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY, serializeMessages(messages));
  storage.setItem(LEGACY_MESSAGES_STORAGE_KEY, serializeMessages(messages));

  persistMessages(storage, messages);

  assert.equal(storage.getItem(DEFAULT_CHAT_STORAGE_KEY), serializeMessages(messages));
  assert.equal(storage.getItem(LEGACY_UNSCOPED_MESSAGES_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_MESSAGES_STORAGE_KEY), null);
});

function createStorageStub(): Storage {
  const storage = new Map<string, string>();

  return {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key) {
      return storage.get(key) ?? null;
    },
    key(index) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key) {
      storage.delete(key);
    },
    setItem(key, value) {
      storage.set(key, value);
    },
  };
}
