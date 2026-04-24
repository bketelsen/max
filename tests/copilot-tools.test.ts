import assert from "node:assert/strict";
import { test } from "node:test";

import type { CopilotClient } from "@github/copilot-sdk";

import { config } from "../src/config.ts";
import { createTools } from "../src/copilot/tools.ts";

test("createTools exposes send_telegram and reports when Telegram is not configured", async () => {
  const originalBotToken = config.telegramBotToken;
  const originalAuthorizedUserId = config.authorizedUserId;

  try {
    config.telegramBotToken = undefined;
    config.authorizedUserId = undefined;

    const tools = createTools({
      client: { listModels: async () => [] } as CopilotClient,
      onAgentTaskComplete: () => {},
    });

    const sendTelegram = tools.find((tool) => tool.name === "send_telegram");
    assert.ok(sendTelegram);
    assert.deepEqual(sendTelegram.parameters.parse({ message: "Send me a test message on Telegram" }), {
      message: "Send me a test message on Telegram",
    });

    const result = await sendTelegram.handler({
      message: "Send me a test message on Telegram",
    });

    assert.equal(result, "Telegram not configured; skipped sending message.");
  } finally {
    config.telegramBotToken = originalBotToken;
    config.authorizedUserId = originalAuthorizedUserId;
  }
});
