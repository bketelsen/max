import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApiClient } from "../src/lib/api-client.ts";
import type { SlashCommandInvocation } from "../src/lib/slash-commands.ts";
import { resolveSlashCommand } from "../src/lib/slash-commands.ts";
import { executeSlashCommandInvocation } from "../src/lib/slash-command-actions.ts";

type FakeApiCall = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

class FakeApiClient implements ApiClient {
  readonly calls: FakeApiCall[] = [];
  private readonly getResponses = new Map<string, unknown>();
  private readonly postResponses = new Map<string, unknown>();

  setGet(path: string, value: unknown) {
    this.getResponses.set(path, value);
  }

  setPost(path: string, value: unknown) {
    this.postResponses.set(path, value);
  }

  async get<T>(path: string): Promise<T> {
    this.calls.push({ method: "GET", path });
    return this.getResponses.get(path) as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: "POST", path, body });
    return this.postResponses.get(path) as T;
  }
}

function createInvocation(
  name: string,
  args = "",
): SlashCommandInvocation {
  const command = resolveSlashCommand(name);
  assert.ok(command);

  return {
    args,
    command,
    input: args ? `/${name} ${args}` : `/${name}`,
    token: `/${name}`,
  };
}

test("/help appends the available slash command list", async () => {
  const apiClient = new FakeApiClient();
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("help"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.equal(apiClient.calls.length, 0);
  assert.match(messages[0] ?? "", /Available slash commands/);
  assert.match(messages[0] ?? "", /\/status — Daemon health check/);
});

test("/clear clears the conversation without appending a message", async () => {
  const apiClient = new FakeApiClient();
  const messages: string[] = [];
  let clearCount = 0;

  await executeSlashCommandInvocation(createInvocation("clear"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => {
      clearCount += 1;
    },
  });

  assert.equal(clearCount, 1);
  assert.deepEqual(messages, []);
  assert.equal(apiClient.calls.length, 0);
});

test("/cancel cancels the active response", async () => {
  const apiClient = new FakeApiClient();
  const messages: string[] = [];
  let cancelCount = 0;

  await executeSlashCommandInvocation(createInvocation("cancel"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => {
      cancelCount += 1;
    },
    clearMessages: () => undefined,
  });

  assert.equal(cancelCount, 1);
  assert.deepEqual(messages, ["Cancelled the current response."]);
  assert.equal(apiClient.calls.length, 0);
});

test("/model without args shows the current model", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/model", { model: "claude-sonnet-4.5" });
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("model"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [{ method: "GET", path: "/model" }]);
  assert.deepEqual(messages, ["Current model: claude-sonnet-4.5"]);
});

test("/model with args switches the model", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setPost("/model", {
    previous: "claude-sonnet-4.5",
    current: "gpt-5.4",
  });
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("model", "gpt-5.4"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [
    { method: "POST", path: "/model", body: { model: "gpt-5.4" } },
  ]);
  assert.deepEqual(messages, ["Model switched: claude-sonnet-4.5 -> gpt-5.4"]);
});

test("/models lists the available models", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/models", {
    models: ["claude-sonnet-4.5", "gpt-5.4"],
    current: "gpt-5.4",
  });
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("models"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [{ method: "GET", path: "/models" }]);
  assert.deepEqual(messages, [
    "Available models\n\nclaude-sonnet-4.5\ngpt-5.4 (current)",
  ]);
});

test("/auto toggles auto routing and reports the new state", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/auto", { enabled: false, currentModel: "claude-sonnet-4.5" });
  apiClient.setPost("/auto", { enabled: true, currentModel: "claude-sonnet-4.5" });
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("auto"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [
    { method: "GET", path: "/auto" },
    { method: "POST", path: "/auto", body: { enabled: true } },
  ]);
  assert.deepEqual(messages, ["Auto routing enabled."]);
});

test("/memory lists stored memories", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/memory", [
    {
      path: "pages/projects/max.md",
      title: "Max",
      summary: "Personal coding assistant",
      tags: ["project", "assistant"],
      updated: "2026-04-24T00:00:00.000Z",
    },
  ]);
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("memory"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [{ method: "GET", path: "/memory" }]);
  assert.deepEqual(messages, [
    "Stored memories\n\nMax — Personal coding assistant [project, assistant]",
  ]);
});

test("/skills lists installed skills", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/skills", [
    {
      slug: "gh-cli",
      name: "gh-cli",
      description: "GitHub CLI reference",
      source: "bundled",
    },
  ]);
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("skills"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [{ method: "GET", path: "/skills" }]);
  assert.deepEqual(messages, [
    "Installed skills\n\ngh-cli (bundled) — GitHub CLI reference",
  ]);
});

test("/agents lists running agents", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/agents", [
    {
      slug: "coder",
      model: "gpt-5.4",
      taskId: "task-123",
      description: "Implementing slash commands",
    },
  ]);
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("agents"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [{ method: "GET", path: "/agents" }]);
  assert.deepEqual(messages, [
    "Running agents\n\n@coder (gpt-5.4) — Implementing slash commands",
  ]);
});

test("/status reports daemon health and workers", async () => {
  const apiClient = new FakeApiClient();
  apiClient.setGet("/status", {
    status: "ok",
    workers: [
      {
        slug: "coder",
        taskId: "task-123",
        description: "Implementing slash commands",
      },
    ],
  });
  const messages: string[] = [];

  await executeSlashCommandInvocation(createInvocation("status"), {
    apiClient,
    appendSystemMessage: (content) => messages.push(content),
    cancel: async () => undefined,
    clearMessages: () => undefined,
  });

  assert.deepEqual(apiClient.calls, [{ method: "GET", path: "/status" }]);
  assert.deepEqual(messages, [
    "Daemon status\n\nStatus: ok\nWorkers: 1\n@coder — Implementing slash commands",
  ]);
});
