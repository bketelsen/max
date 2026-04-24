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

test("resolveRestoredMessages hydrates an empty cache from server history", () => {
  const historyMessages: UIMessage[] = [
    { id: "history-1", role: "user", text: "recovered question" },
    { id: "history-2", role: "assistant", text: "recovered answer" },
  ];

  assert.deepEqual(
    resolveRestoredMessages({ cachedMessages: [], historyMessages }),
    historyMessages
  );
});

test("resolveRestoredMessages keeps newer cached messages when server history is an older prefix", () => {
  const cachedMessages: UIMessage[] = [
    { id: "cached-1", role: "user", text: "question 1" },
    { id: "cached-2", role: "assistant", text: "answer 1" },
    { id: "cached-3", role: "user", text: "question 2" },
    { id: "cached-4", role: "assistant", text: "answer 2" },
  ];
  const historyMessages: UIMessage[] = [
    { id: "history-1", role: "user", text: "question 1" },
    { id: "history-2", role: "assistant", text: "answer 1" },
  ];

  assert.deepEqual(
    resolveRestoredMessages({ cachedMessages, historyMessages }),
    cachedMessages
  );
});

test("resolveRestoredMessages appends newer server history without duplicating the shared prefix", () => {
  const cachedMessages: UIMessage[] = [
    { id: "cached-1", role: "user", text: "question 1" },
    { id: "cached-2", role: "assistant", text: "answer 1" },
  ];
  const historyMessages: UIMessage[] = [
    { id: "history-1", role: "user", text: "question 1" },
    { id: "history-2", role: "assistant", text: "answer 1" },
    { id: "history-3", role: "user", text: "question 2" },
    { id: "history-4", role: "assistant", text: "answer 2" },
  ];

  assert.deepEqual(resolveRestoredMessages({ cachedMessages, historyMessages }), [
    ...cachedMessages,
    { id: "history-3", role: "user", text: "question 2" },
    { id: "history-4", role: "assistant", text: "answer 2" },
  ]);
});
