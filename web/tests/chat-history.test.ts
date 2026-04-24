import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRestoredMessages } from "../src/lib/chat-history.ts";
import type { UIMessage } from "../src/lib/chat-types.ts";

test("resolveRestoredMessages prefers persisted history when the server returns messages", () => {
  const cachedMessages: UIMessage[] = [
    { id: "cached-1", role: "user", text: "cached question" },
  ];
  const historyMessages: UIMessage[] = [
    { id: "history-1", role: "user", text: "server question" },
    { id: "history-2", role: "assistant", text: "server answer" },
  ];

  assert.deepEqual(
    resolveRestoredMessages({ cachedMessages, historyMessages }),
    historyMessages
  );
});

test("resolveRestoredMessages keeps cached messages when history is empty", () => {
  const cachedMessages: UIMessage[] = [
    { id: "cached-1", role: "user", text: "still visible" },
    { id: "cached-2", role: "assistant", text: "until restore finishes" },
  ];

  assert.deepEqual(
    resolveRestoredMessages({ cachedMessages, historyMessages: [] }),
    cachedMessages
  );
});
