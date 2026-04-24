import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentConfig } from "../src/copilot/agents.ts";
import { buildEphemeralSessionRequest } from "../src/copilot/agents.ts";
import { describeCopilotError, isRecoverableCopilotError } from "../src/copilot/errors.ts";

const coderAgent: AgentConfig = {
  slug: "coder",
  name: "Coder",
  description: "Writes code",
  model: "gpt-5.4",
  systemMessage: "You are Coder.",
};

test("buildEphemeralSessionRequest disables streaming for delegated agent sessions", () => {
  const request = buildEphemeralSessionRequest(coderAgent, [], {
    configDir: "/tmp/max-sessions",
    workingDirectory: "/tmp/workspace",
    mcpServers: {},
    skillDirectories: [],
  });

  assert.equal(request.model, "gpt-5.4");
  assert.equal(request.streaming, false);
  assert.equal(request.configDir, "/tmp/max-sessions");
  assert.equal(request.workingDirectory, "/tmp/workspace");
});

test("buildEphemeralSessionRequest applies explicit model overrides", () => {
  const request = buildEphemeralSessionRequest(coderAgent, [], {
    configDir: "/tmp/max-sessions",
    workingDirectory: "/tmp/workspace",
    mcpServers: {},
    skillDirectories: [],
    modelOverride: "claude-sonnet-4.6",
  });

  assert.equal(request.model, "claude-sonnet-4.6");
  assert.equal(request.streaming, false);
});

test("describeCopilotError unwraps nested unknown errors into a meaningful message", () => {
  const rootCause = new Error("missing finish_reason for choice 0");
  const providerError = new Error(
    "Failed to get response from the AI model; retried 5 times (total retry wait time: 5.81 seconds) Last error: Unknown error",
    { cause: rootCause }
  );
  const wrapped = new Error(`Execution failed: ${providerError.message}`, { cause: providerError });

  const details = describeCopilotError(wrapped);

  assert.equal(
    details.userMessage,
    "Execution failed: Failed to get response from the AI model after retries. Root cause: missing finish_reason for choice 0"
  );
  assert.match(details.logMessage, /Root cause: missing finish_reason for choice 0/);
});

test("isRecoverableCopilotError treats transient streaming parser failures as retryable", () => {
  assert.equal(isRecoverableCopilotError(new Error("missing finish_reason for choice 0")), true);
  assert.equal(isRecoverableCopilotError(new Error("Session not found: abc")), true);
  assert.equal(isRecoverableCopilotError(new Error("Request timed out")), false);
});
