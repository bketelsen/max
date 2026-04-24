import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendSystemMessage,
  createSystemMessage,
  HYDRATED_MESSAGE_LIMIT,
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

test("chat history hydration stays capped at 50 messages", () => {
  assert.equal(HYDRATED_MESSAGE_LIMIT, 50);
});
