import { z } from "zod";
import { approveAll, defineTool, type CopilotClient, type CopilotSession, type Tool } from "@github/copilot-sdk";
import { getDb } from "../store/db.js";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, sep, resolve } from "path";
import { homedir } from "os";
import { listSkills, createSkill, removeSkill } from "./skills.js";
import { config, persistModel } from "../config.js";
import { SESSIONS_DIR } from "../paths.js";
import { getCurrentSourceChannel, switchSessionModel } from "./orchestrator.js";
import { getRouterConfig, updateRouterConfig } from "./router.js";
import { describeCopilotError } from "./errors.js";
import {
  getAgentRegistry, getAgent, createEphemeralAgentSession, getAgentSessionStatus,
  getActiveTasks, getTask, registerTask, completeTask, failTask, resolveAgentModel,
  createAgentFile, removeAgentFile, loadAgents,
  type AgentConfig, type AgentTaskInfo,
} from "./agents.js";

export interface ToolDeps {
  client: CopilotClient;
  onAgentTaskComplete: (taskId: string, agentSlug: string, result: string) => void;
}

export function createTools(deps: ToolDeps): Tool<any>[] {
  return [
    // ----- Agent Delegation Tools (for @max) -----

    defineTool("delegate_to_agent", {
      description:
        "Delegate a task to a specialist agent. The task runs in the background — you'll be notified when it's done. " +
        "Available agents: use show_agent_roster to see the roster. For @general-purpose, specify model_override based on task complexity.",
      parameters: z.object({
        agent_name: z.string().describe("Name or slug of the agent to delegate to (e.g. 'coder', 'designer', 'general-purpose')"),
        task: z.string().describe("Detailed task description for the agent"),
        summary: z.string().describe("Short human-readable summary of the task (under 80 chars, e.g. 'Fix login button styling')"),
        model_override: z.string().optional().describe("Model override for agents with model 'auto' (e.g. 'gpt-4.1', 'claude-sonnet-4.6', 'claude-opus-4.6')"),
      }),
      handler: async (args) => {
        const agent = getAgent(args.agent_name);
        if (!agent) {
          const available = getAgentRegistry().map((a) => a.slug).join(", ");
          return `Agent '${args.agent_name}' not found. Available agents: ${available}`;
        }
        if (agent.slug === "max") {
          return "Cannot delegate to yourself. Handle this directly or pick a specialist agent.";
        }

        let session: CopilotSession;
        try {
          // Get all tools so we can filter for this agent
          const allTools = createTools(deps);
          session = await createEphemeralAgentSession(agent.slug, deps.client, allTools, args.model_override);
        } catch (err) {
          const details = describeCopilotError(err);
          return `Failed to create session for @${agent.slug}: ${details.userMessage}`;
        }

        const task = registerTask(agent.slug, args.summary, getCurrentSourceChannel());

        // Persist task to DB
        const db = getDb();
        db.prepare(
          `INSERT INTO agent_tasks (task_id, agent_slug, description, status, origin_channel) VALUES (?, ?, ?, 'running', ?)`
        ).run(task.taskId, agent.slug, args.summary, task.originChannel || null);

        const timeoutMs = config.workerTimeoutMs;
        // Non-blocking: dispatch and return immediately. Session is always destroyed after.
        (async () => {
          try {
            const result = await session.sendAndWait({ prompt: args.task }, timeoutMs);
            const output = result?.data?.content || "No response";
            completeTask(task.taskId, output);
            db.prepare(`UPDATE agent_tasks SET status = 'completed', result = ?, completed_at = CURRENT_TIMESTAMP WHERE task_id = ?`).run(output.slice(0, 10000), task.taskId);
            deps.onAgentTaskComplete(task.taskId, agent.slug, output);
          } catch (err) {
            const details = describeCopilotError(err);
            console.error(`[agents] Task ${task.taskId} for @${agent.slug} failed: ${details.logMessage}`);
            failTask(task.taskId, details.userMessage);
            db.prepare(`UPDATE agent_tasks SET status = 'error', result = ?, completed_at = CURRENT_TIMESTAMP WHERE task_id = ?`).run(details.userMessage, task.taskId);
            deps.onAgentTaskComplete(task.taskId, agent.slug, `Error: ${details.userMessage}`);
          } finally {
            session.destroy().catch(() => {});
          }
        })();

        const model = resolveAgentModel(agent, args.model_override);
        return `Task delegated to @${agent.slug} (${model}). Task ID: ${task.taskId}. I'll notify you when it's done.`;
      },
    }),

    defineTool("check_agent_status", {
      description: "Check the status of an agent or a specific delegated task.",
      parameters: z.object({
        agent_name: z.string().optional().describe("Agent name/slug to check"),
        task_id: z.string().optional().describe("Specific task ID to check"),
      }),
      handler: async (args) => {
        if (args.task_id) {
          const task = getTask(args.task_id);
          if (!task) return `Task '${args.task_id}' not found.`;
          const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
          let info = `Task ${task.taskId} (@${task.agentSlug})\nStatus: ${task.status}\nDescription: ${task.description}\nElapsed: ${elapsed}s`;
          if (task.result) info += `\n\nResult:\n${task.result.slice(0, 2000)}`;
          return info;
        }

        if (args.agent_name) {
          const agent = getAgent(args.agent_name);
          if (!agent) return `Agent '${args.agent_name}' not found.`;
          const status = getAgentSessionStatus(agent.slug);
          let info = `@${agent.slug} (${agent.name})\nModel: ${agent.model}`;
          if (status.tasks.length > 0) {
            info += `\n\nActive tasks (${status.tasks.length}):`;
            for (const t of status.tasks) {
              info += `\n• ${t.taskId}: ${t.description} (${t.status})`;
            }
          }
          return info;
        }

        // Show all agents
        const agents = getAgentRegistry();
        const lines = agents.map((a) => {
          const status = getAgentSessionStatus(a.slug);
          const runningTasks = status.tasks.filter((t) => t.status === "running");
          const sessionBadge = runningTasks.length > 0 ? "●" : "○";
          const taskInfo = runningTasks.length > 0 ? ` (${runningTasks.length} task(s) running)` : "";
          return `${sessionBadge} @${a.slug} — ${a.description} [${a.model}]${taskInfo}`;
        });
        return `Agents (${agents.length}):\n${lines.join("\n")}`;
      },
    }),

    defineTool("get_agent_result", {
      description: "Get the result of a completed agent task.",
      parameters: z.object({
        task_id: z.string().describe("The task ID (from delegate_to_agent)"),
      }),
      handler: async (args) => {
        const task = getTask(args.task_id);
        if (!task) {
          // Check DB for completed tasks that may have been cleared from memory
          const db = getDb();
          const row = db.prepare(`SELECT * FROM agent_tasks WHERE task_id = ?`).get(args.task_id) as any;
          if (!row) return `Task '${args.task_id}' not found.`;
          return `Task ${row.task_id} (@${row.agent_slug})\nStatus: ${row.status}\nDescription: ${row.description}\n\nResult:\n${row.result || "(no result)"}`;
        }
        if (task.status === "running") {
          const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
          return `Task ${task.taskId} is still running (${elapsed}s elapsed).`;
        }
        return `Task ${task.taskId} (@${task.agentSlug}) — ${task.status}\n\nResult:\n${task.result || "(no result)"}`;
      },
    }),

    defineTool("show_agent_roster", {
      description: "List all registered agents with their name, model, status, and current tasks.",
      parameters: z.object({}),
      handler: async () => {
        const agents = getAgentRegistry();
        if (agents.length === 0) return "No agents registered.";

        const lines = agents.map((a) => {
          const status = getAgentSessionStatus(a.slug);
          const runningTasks = status.tasks.filter((t) => t.status === "running");
          const badge = runningTasks.length > 0 ? "● working" : "○ idle";
          const taskInfo = runningTasks.length > 0
            ? `\n    Tasks: ${runningTasks.map((t) => `${t.taskId}: ${t.description}`).join(", ")}`
            : "";
          return `• @${a.slug} (${a.name}) — ${a.model} — ${badge}${taskInfo}\n  ${a.description}`;
        });
        return `Registered agents (${agents.length}):\n${lines.join("\n")}`;
      },
    }),

    defineTool("hire_agent", {
      description:
        "Create a new custom agent by writing an .agent.md file to ~/.max/agents/. " +
        "The agent will be available immediately after creation.",
      parameters: z.object({
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("Kebab-case identifier, e.g. 'data-analyst'"),
        name: z.string().describe("Human-readable name"),
        description: z.string().describe("One-line description of the agent's specialty"),
        model: z.string().describe("Model to use (e.g. 'claude-sonnet-4.6', 'gpt-5.4', or 'auto')"),
        system_prompt: z.string().describe("The agent's system prompt (markdown)"),
        skills: z.array(z.string()).optional().describe("Skills to attach to this agent"),
        tools: z.array(z.string()).optional().describe("Tool allowlist (omit for all execution tools)"),
      }),
      handler: async (args) => {
        const err = createAgentFile(
          args.slug, args.name, args.description, args.model,
          args.system_prompt, args.skills, args.tools
        );
        if (err) return err;
        // Reload registry
        loadAgents();
        return `Agent @${args.slug} created. It's ready for delegation.`;
      },
    }),

    defineTool("fire_agent", {
      description: "Remove a custom agent's .agent.md file and destroy its session. Cannot remove built-in agents.",
      parameters: z.object({
        slug: z.string().describe("The agent slug to remove"),
      }),
      handler: async (args) => {
        const err = removeAgentFile(args.slug);
        if (err) return err;
        loadAgents();
        return `Agent @${args.slug} removed.`;
      },
    }),

    defineTool("list_machine_sessions", {
      description:
        "List ALL Copilot CLI sessions on this machine — including sessions started from VS Code, " +
        "the terminal, or other tools. Shows session ID, summary, working directory. " +
        "Use this when the user asks about existing sessions running on the machine. " +
        "By default shows the 20 most recently active sessions.",
      parameters: z.object({
        cwd_filter: z.string().optional().describe("Optional: only show sessions whose working directory contains this string"),
        limit: z.number().int().min(1).max(100).optional().describe("Max sessions to return (default 20)"),
      }),
      handler: async (args) => {
        const sessionStateDir = join(homedir(), ".copilot", "session-state");
        const limit = args.limit || 20;

        let entries: { id: string; cwd: string; summary: string; updatedAt: Date }[] = [];

        try {
          const dirs = readdirSync(sessionStateDir);
          for (const dir of dirs) {
            const yamlPath = join(sessionStateDir, dir, "workspace.yaml");
            try {
              const content = readFileSync(yamlPath, "utf-8");
              const parsed = parseSimpleYaml(content);
              if (args.cwd_filter && !parsed.cwd?.includes(args.cwd_filter)) continue;
              entries.push({
                id: parsed.id || dir,
                cwd: parsed.cwd || "unknown",
                summary: parsed.summary || "",
                updatedAt: parsed.updated_at ? new Date(parsed.updated_at) : new Date(0),
              });
            } catch {
              // Skip dirs without valid workspace.yaml
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
            return "No Copilot sessions found on this machine (session state directory does not exist yet).";
          }
          return "Could not read session state directory.";
        }

        // Sort by most recently updated
        entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        entries = entries.slice(0, limit);

        if (entries.length === 0) {
          return "No Copilot sessions found on this machine.";
        }

        const lines = entries.map((s) => {
          const age = formatAge(s.updatedAt);
          const summary = s.summary ? ` — ${s.summary}` : "";
          return `• ID: ${s.id}\n  ${s.cwd} (${age})${summary}`;
        });

        return `Found ${entries.length} session(s) (most recent first):\n${lines.join("\n")}`;
      },
    }),

    defineTool("attach_machine_session", {
      description:
        "Attach to an existing Copilot CLI session on this machine (e.g. one started from VS Code or terminal). " +
        "Resumes the session so you can observe or interact with it.",
      parameters: z.object({
        session_id: z.string().describe("The session ID to attach to (from list_machine_sessions)"),
        name: z.string().describe("A short name to reference this session by, e.g. 'vscode-main'"),
      }),
      handler: async (args) => {
        try {
          const session = await deps.client.resumeSession(args.session_id, {
            model: config.copilotModel,
            onPermissionRequest: approveAll,
          });

          const db = getDb();
          db.prepare(
            `INSERT OR REPLACE INTO agent_sessions (slug, copilot_session_id, model, status)
             VALUES (?, ?, ?, 'idle')`
          ).run(args.name, args.session_id, config.copilotModel);

          return `Attached to session ${args.session_id.slice(0, 8)}… as '${args.name}'.`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Failed to attach to session: ${msg}`;
        }
      },
    }),

    defineTool("list_skills", {
      description:
        "List all available skills that Max knows. Skills are instruction documents that teach Max " +
        "how to use external tools and services (e.g. Gmail, browser automation, YouTube transcripts). " +
        "Shows skill name, description, and whether it's a local or global skill.",
      parameters: z.object({}),
      handler: async () => {
        const skills = listSkills();
        if (skills.length === 0) {
          return "No skills installed yet. Use learn_skill to teach me something new.";
        }
        const lines = skills.map(
          (s) => `• ${s.name} (${s.source}) — ${s.description}`
        );
        return `Available skills (${skills.length}):\n${lines.join("\n")}`;
      },
    }),

    defineTool("learn_skill", {
      description:
        "Teach Max a new skill by creating a SKILL.md instruction file. Use this when the user asks Max " +
        "to do something it doesn't know how to do yet (e.g. 'check my email', 'search the web'). " +
        "First, use a worker session to research what CLI tools are available on the system (run 'which', " +
        "'--help', etc.), then create the skill with the instructions you've learned. " +
        "The skill becomes available on the next message (no restart needed).",
      parameters: z.object({
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("Short kebab-case identifier for the skill, e.g. 'gmail', 'web-search'"),
        name: z.string().refine(s => !s.includes('\n'), "must be single-line").describe("Human-readable name for the skill, e.g. 'Gmail', 'Web Search'"),
        description: z.string().refine(s => !s.includes('\n'), "must be single-line").describe("One-line description of when to use this skill"),
        instructions: z.string().describe(
          "Markdown instructions for how to use the skill. Include: what CLI tool to use, " +
          "common commands with examples, authentication steps if needed, tips and gotchas. " +
          "This becomes the SKILL.md content body."
        ),
      }),
      handler: async (args) => {
        return createSkill(args.slug, args.name, args.description, args.instructions);
      },
    }),

    defineTool("uninstall_skill", {
      description:
        "Remove a skill from Max's local skills directory (~/.max/skills/). " +
        "The skill will no longer be available on the next message. " +
        "Only works for local skills — bundled and global skills cannot be removed this way.",
      parameters: z.object({
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe("The kebab-case slug of the skill to remove, e.g. 'gmail', 'web-search'"),
      }),
      handler: async (args) => {
        const result = removeSkill(args.slug);
        return result.message;
      },
    }),

    defineTool("list_models", {
      description:
        "List all available Copilot models. Shows model id, name, and billing tier. " +
        "Marks the currently active model. Use when the user asks what models are available " +
        "or wants to know which model is in use.",
      parameters: z.object({}),
      handler: async () => {
        try {
          const models = await deps.client.listModels();
          if (models.length === 0) {
            return "No models available.";
          }
          const current = config.copilotModel;
          const lines = models.map((m) => {
            const active = m.id === current ? " ← active" : "";
            const billing = m.billing ? ` (${m.billing.multiplier}x)` : "";
            return `• ${m.id}${billing}${active}`;
          });
          return `Available models (${models.length}):\n${lines.join("\n")}\n\nCurrent: ${current}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Failed to list models: ${msg}`;
        }
      },
    }),

    defineTool("switch_model", {
      description:
        "Switch the Copilot model Max uses for conversations. Takes effect on the next message. " +
        "The change is persisted across restarts. Use when the user asks to change or switch models.",
      parameters: z.object({
        model_id: z.string().describe("The model id to switch to (from list_models)"),
      }),
      handler: async (args) => {
        try {
          const models = await deps.client.listModels();
          const match = models.find((m) => m.id === args.model_id);
          if (!match) {
            const suggestions = models
              .filter((m) => m.id.includes(args.model_id) || m.id.toLowerCase().includes(args.model_id.toLowerCase()))
              .map((m) => m.id);
            const hint = suggestions.length > 0
              ? ` Did you mean: ${suggestions.join(", ")}?`
              : " Use list_models to see available options.";
            return `Model '${args.model_id}' not found.${hint}`;
          }

          const previous = config.copilotModel;
          config.copilotModel = args.model_id;
          persistModel(args.model_id);

          // Apply model change to the live session immediately
          try {
            await switchSessionModel(args.model_id);
          } catch (err) {
            console.log(`[max] setModel() failed during switch_model (will apply on next session): ${err instanceof Error ? err.message : err}`);
          }

          // Disable router when manually switching — user has explicit preference
          if (getRouterConfig().enabled) {
            updateRouterConfig({ enabled: false });
            return `Switched model from '${previous}' to '${args.model_id}'. Auto-routing disabled (use /auto or toggle_auto to re-enable).`;
          }

          return `Switched model from '${previous}' to '${args.model_id}'.`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Failed to switch model: ${msg}`;
        }
      },
    }),

    defineTool("toggle_auto", {
      description:
        "Enable or disable automatic model routing (auto mode). When enabled, Max automatically picks " +
        "the best model (fast/standard/premium) for each message to save cost and optimize speed. " +
        "Use when the user asks to turn auto-routing on or off.",
      parameters: z.object({
        enabled: z.boolean().describe("true to enable auto-routing, false to disable"),
      }),
      handler: async (args) => {
        const updated = updateRouterConfig({ enabled: args.enabled });
        if (args.enabled) {
          const tiers = updated.tierModels;
          return `Auto-routing enabled. Tier models:\n• fast: ${tiers.fast}\n• standard: ${tiers.standard}\n• premium: ${tiers.premium}\n\nMax will automatically pick the best model for each message.`;
        }
        return `Auto-routing disabled. Using fixed model: ${config.copilotModel}`;
      },
    }),

    defineTool("send_telegram", {
      description:
        "Send a message to the user on Telegram. Use this to notify the user of important events, " +
        "task completions, or proactive updates. The message will be delivered to their authorized Telegram account.",
      parameters: z.object({
        message: z.string().describe("The message to send. Supports Markdown formatting."),
      }),
      handler: async ({ message }) => {
        if (!config.telegramEnabled) {
          return "Telegram not configured; skipped sending message.";
        }

        const { sendProactiveMessage } = await import("../telegram/bot.js");
        await sendProactiveMessage(message);
        return "Message sent to Telegram";
      },
    }),


    defineTool("restart_max", {
      description:
        "Restart the Max daemon process. Use when the user asks Max to restart himself, " +
        "or when a restart is needed to pick up configuration changes. " +
        "Spawns a new process and exits the current one.",
      parameters: z.object({
        reason: z.string().optional().describe("Optional reason for the restart"),
      }),
      handler: async (args) => {
        const reason = args.reason ? ` (${args.reason})` : "";
        // Dynamic import to avoid circular dependency
        const { restartDaemon } = await import("../daemon.js");
        // Schedule restart after returning the response
        setTimeout(() => {
          restartDaemon().catch((err) => {
            console.error("[max] Restart failed:", err);
          });
        }, 1000);
        return `Restarting Max${reason}. I'll be back in a few seconds.`;
      },
    }),
  ];
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function parseSimpleYaml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 2).trim();
      result[key] = value;
    }
  }
  return result;
}
