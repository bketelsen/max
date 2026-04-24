export type SlashCommand = {
  name: string;
  description: string;
  kind: "action" | "input";
  aliases?: string[];
  args?: string;
};

export type SlashCommandInputState = {
  isOpen: boolean;
  search: string;
  token: string;
};

export type SlashCommandInvocation = {
  input: string;
  token: string;
  command: SlashCommand;
  args: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show available commands", kind: "action" },
  { name: "clear", description: "Clear conversation", kind: "action" },
  { name: "cancel", description: "Cancel current response", kind: "action" },
  {
    name: "model",
    description: "Show or switch model",
    kind: "input",
    args: "[name]",
  },
  { name: "models", description: "List available models", kind: "action" },
  { name: "auto", description: "Toggle auto routing", kind: "action" },
  { name: "memory", description: "Show stored memories", kind: "action" },
  { name: "skills", description: "List installed skills", kind: "action" },
  {
    name: "agents",
    description: "List running agents",
    kind: "action",
    aliases: ["sessions"],
  },
  { name: "status", description: "Daemon health check", kind: "action" },
];

function normalizeSlashTerm(value: string): string {
  return value.trim().replace(/^\//, "").toLowerCase();
}

function getSearchTerms(command: SlashCommand): string[] {
  return [
    command.name,
    command.description,
    command.args ?? "",
    ...(command.aliases ?? []),
  ].map((value) => value.toLowerCase());
}

export function resolveSlashCommand(value: string): SlashCommand | undefined {
  const normalized = normalizeSlashTerm(value);

  if (!normalized) {
    return undefined;
  }

  return SLASH_COMMANDS.find(
    (command) =>
      command.name === normalized ||
      command.aliases?.some((alias) => alias === normalized)
  );
}

export function filterSlashCommands(search: string): SlashCommand[] {
  const normalized = normalizeSlashTerm(search);

  if (!normalized) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS.filter((command) =>
    getSearchTerms(command).some((term) => term.includes(normalized))
  );
}

export function parseSlashCommandInput(value: string): SlashCommandInputState {
  const trimmedStart = value.trimStart();
  const match = trimmedStart.match(/^\/\S*/);

  if (!match) {
    return { isOpen: false, search: "", token: "" };
  }

  const token = match[0];
  const remaining = trimmedStart.slice(token.length);

  return {
    isOpen: remaining.length === 0,
    search: token.slice(1),
    token,
  };
}

export function parseSlashCommandInvocation(
  value: string
): SlashCommandInvocation | null {
  const trimmed = value.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }

  const token = match[1];
  const command = resolveSlashCommand(token);

  if (!command) {
    return null;
  }

  return {
    args: match[2]?.trim() ?? "",
    command,
    input: trimmed,
    token,
  };
}
