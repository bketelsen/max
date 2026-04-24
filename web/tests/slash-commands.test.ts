import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterSlashCommands,
  parseSlashCommandInput,
  parseSlashCommandInvocation,
  resolveSlashCommand,
  SLASH_COMMANDS,
} from "../src/lib/slash-commands.ts";

test("slash command registry defines the expected v1 commands", () => {
  assert.equal(SLASH_COMMANDS.length, 10);
  assert.deepEqual(
    SLASH_COMMANDS.map((command) => command.name),
    [
      "help",
      "clear",
      "cancel",
      "model",
      "models",
      "auto",
      "memory",
      "skills",
      "agents",
      "status",
    ]
  );
});

test("slash command filtering matches aliases for discoverability", () => {
  const matches = filterSlashCommands("sess");

  assert.deepEqual(matches.map((command) => command.name), ["agents"]);
  assert.deepEqual(matches[0]?.aliases, ["sessions"]);
});

test("slash command parsing only opens from the first token", () => {
  assert.deepEqual(parseSlashCommandInput("/mo"), {
    isOpen: true,
    search: "mo",
    token: "/mo",
  });
  assert.deepEqual(parseSlashCommandInput("hello /mo"), {
    isOpen: false,
    search: "",
    token: "",
  });
});

test("slash command invocation resolves aliases and arguments", () => {
  assert.equal(resolveSlashCommand("sessions")?.name, "agents");
  assert.deepEqual(parseSlashCommandInvocation("/model claude-sonnet-4.5"), {
    args: "claude-sonnet-4.5",
    command: resolveSlashCommand("model"),
    input: "/model claude-sonnet-4.5",
    token: "/model",
  });
});
