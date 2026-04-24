import assert from "node:assert/strict";
import { test } from "node:test";

import { persistConversationAndDeliver } from "../src/copilot/orchestrator.ts";

test("persistConversationAndDeliver stores both conversation turns before delivering the final response", () => {
  const events: string[] = [];

  persistConversationAndDeliver({
    logRole: "user",
    prompt: "hello",
    finalContent: "hi there",
    sourceLabel: "web",
    callback: () => {
      events.push("callback");
    },
    logConversationFn: (role, content, source) => {
      events.push(`persist:${role}:${content}:${source}`);
    },
    logMessageFn: (_direction, source, text) => {
      events.push(`stdout:${source}:${text}`);
    },
    errorLogger: (message) => {
      events.push(`error:${message}`);
    },
  });

  assert.deepEqual(events, [
    "persist:user:hello:web",
    "persist:assistant:hi there:web",
    "callback",
    "stdout:web:hi there",
  ]);
});

test("persistConversationAndDeliver still delivers the final response when persistence fails", () => {
  const events: string[] = [];

  persistConversationAndDeliver({
    logRole: "user",
    prompt: "hello",
    finalContent: "hi there",
    sourceLabel: "web",
    callback: () => {
      events.push("callback");
    },
    logConversationFn: (role) => {
      events.push(`persist:${role}`);
      throw new Error("database locked");
    },
    logMessageFn: (_direction, source, text) => {
      events.push(`stdout:${source}:${text}`);
    },
    errorLogger: (message) => {
      events.push(`error:${message}`);
    },
  });

  assert.deepEqual(events, [
    "persist:user",
    "error:[max] Failed to persist conversation: database locked",
    "callback",
    "stdout:web:hi there",
  ]);
});
