import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearConversationLog,
  getRecentConversationMessages,
  logConversation,
} from "../src/store/db.ts";

test("getRecentConversationMessages returns the latest 50 web messages in chronological order", () => {
  clearConversationLog();

  logConversation("user", "telegram message", "telegram");
  logConversation("assistant", "tui response", "tui");

  for (let index = 0; index < 55; index += 1) {
    const role = index % 2 === 0 ? "user" : "assistant";
    logConversation(role, `web message ${index + 1}`, "web");
  }

  const messages = getRecentConversationMessages({ limit: 50, source: "web" });

  assert.equal(messages.length, 50);
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.text, "web message 6");
  assert.equal(messages.at(-1)?.role, "user");
  assert.equal(messages.at(-1)?.text, "web message 55");
});

test("getRecentConversationMessages restores proactive messages delivered to web clients", () => {
  clearConversationLog();

  logConversation("user", "web question", "web");
  logConversation("assistant", "web answer", "web");
  logConversation("assistant", "background completion", "web:proactive");

  const messages = getRecentConversationMessages({ limit: 50, source: "web" });

  assert.deepEqual(
    messages.map((message) => ({
      role: message.role,
      text: message.text,
      proactive: "proactive" in message ? (message as { proactive?: boolean }).proactive : undefined,
    })),
    [
      { role: "user", text: "web question", proactive: undefined },
      { role: "assistant", text: "web answer", proactive: undefined },
      { role: "assistant", text: "background completion", proactive: true },
    ]
  );
});
