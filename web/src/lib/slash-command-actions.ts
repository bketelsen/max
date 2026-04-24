import type { ApiClient } from "./api-client.ts";
import { SLASH_COMMANDS, type SlashCommandInvocation } from "./slash-commands.ts";

type AgentInfo = {
  slug: string;
  model: string;
  taskId: string;
  description: string;
};

type StatusResponse = {
  status: string;
  workers: Array<Pick<AgentInfo, "slug" | "taskId" | "description">>;
};

type ModelResponse = {
  model: string;
};

type ModelSwitchResponse = {
  previous: string;
  current: string;
};

type ModelsResponse = {
  models: string[];
  current: string;
};

type AutoResponse = {
  enabled: boolean;
  currentModel: string;
};

type MemoryEntry = {
  path: string;
  title: string;
  summary: string;
  tags: string[];
  updated: string;
};

type SkillInfo = {
  slug: string;
  name: string;
  description: string;
  source: "bundled" | "local" | "global";
};

export type SlashCommandActionContext = {
  apiClient: ApiClient;
  appendSystemMessage: (content: string) => void;
  cancel: () => void | Promise<void>;
  clearMessages: () => void;
};

function formatList(title: string, lines: string[]): string {
  return [title, lines.length > 0 ? "" : "No results.", ...lines].join("\n");
}

function formatHelpText(): string {
  const lines = SLASH_COMMANDS.map((command) => {
    const aliases = command.aliases?.length
      ? ` · aliases: ${command.aliases.map((alias) => `/${alias}`).join(", ")}`
      : "";
    const args = command.args ? ` ${command.args}` : "";

    return `/${command.name}${args} — ${command.description}${aliases}`;
  });

  return formatList("Available slash commands", lines);
}

export async function executeSlashCommandInvocation(
  invocation: SlashCommandInvocation,
  { apiClient, appendSystemMessage, cancel, clearMessages }: SlashCommandActionContext
) {
  const { args, command } = invocation;

  switch (command.name) {
    case "help": {
      appendSystemMessage(formatHelpText());
      return;
    }
    case "clear": {
      clearMessages();
      return;
    }
    case "cancel": {
      await cancel();
      appendSystemMessage("Cancelled the current response.");
      return;
    }
    case "model": {
      if (args) {
        const data = await apiClient.post<ModelSwitchResponse>("/model", {
          model: args,
        });
        appendSystemMessage(`Model switched: ${data.previous} -> ${data.current}`);
        return;
      }

      const data = await apiClient.get<ModelResponse>("/model");
      appendSystemMessage(`Current model: ${data.model}`);
      return;
    }
    case "models": {
      const data = await apiClient.get<ModelsResponse>("/models");
      const lines = data.models.map((model) =>
        model === data.current ? `${model} (current)` : model
      );
      appendSystemMessage(formatList("Available models", lines));
      return;
    }
    case "auto": {
      const current = await apiClient.get<AutoResponse>("/auto");
      const updated = await apiClient.post<AutoResponse>("/auto", {
        enabled: !current.enabled,
      });
      appendSystemMessage(
        updated.enabled
          ? "Auto routing enabled."
          : `Auto routing disabled. Using ${updated.currentModel}.`
      );
      return;
    }
    case "memory": {
      const memories = await apiClient.get<MemoryEntry[]>("/memory");
      const lines = memories.map((memory) => {
        const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
        return `${memory.title || memory.path} — ${memory.summary}${tags}`;
      });
      appendSystemMessage(formatList("Stored memories", lines));
      return;
    }
    case "skills": {
      const skills = await apiClient.get<SkillInfo[]>("/skills");
      const lines = skills.map(
        (skill) => `${skill.name} (${skill.source}) — ${skill.description}`
      );
      appendSystemMessage(formatList("Installed skills", lines));
      return;
    }
    case "agents": {
      const agents = await apiClient.get<AgentInfo[]>("/agents");
      const lines = agents.map(
        (agent) => `@${agent.slug} (${agent.model}) — ${agent.description || agent.taskId}`
      );
      appendSystemMessage(formatList("Running agents", lines));
      return;
    }
    case "status": {
      const status = await apiClient.get<StatusResponse>("/status");
      const lines = [
        `Status: ${status.status}`,
        `Workers: ${status.workers.length}`,
        ...status.workers.map(
          (worker) => `@${worker.slug} — ${worker.description || worker.taskId}`
        ),
      ];
      appendSystemMessage(formatList("Daemon status", lines));
      return;
    }
  }
}
