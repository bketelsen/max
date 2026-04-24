// ---------------------------------------------------------------------------
// Orchestrator system message builder. Loads the user-editable COG soul from
// ~/.max/cog/SYSTEM.md (bundled default copied in by ensureCogStructure) and
// appends Max-specific runtime plumbing + the dynamic L0 memory payload.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  COG_SYSTEM_PATH, COG_MEMORY_DIR, COG_META_DIR, COG_DOMAINS_PATH,
} from "../paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SYSTEM_MD = join(__dirname, "..", "cog", "default-system.md");

const FORESIGHT_FRESH_MS = 24 * 60 * 60 * 1000;
const L0_TOTAL_BUDGET = 8_000;       // ~8 KB cap on the dynamic memory payload
const L0_PER_FILE_CAP = 3_500;       // per-file cap inside the payload

function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function loadSystemCore(): string {
  if (existsSync(COG_SYSTEM_PATH)) {
    const content = readText(COG_SYSTEM_PATH);
    if (content.trim().length > 0) return content;
  }
  return readText(BUNDLED_SYSTEM_MD);
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, max).trimEnd() + `\n… [truncated at ${max} chars]`,
    truncated: true,
  };
}

function fileFresh(path: string, maxAgeMs: number): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Pull hot-memory.md + cog-meta/patterns.md + fresh foresight + domains header
 * into an L0 context block. Capped at L0_TOTAL_BUDGET chars.
 */
export function getCogStartupContext(): string {
  const sections: string[] = [];
  let budget = L0_TOTAL_BUDGET;

  function addSection(title: string, path: string, freshnessMs?: number): void {
    if (!existsSync(path)) return;
    if (freshnessMs !== undefined && !fileFresh(path, freshnessMs)) return;
    const raw = readText(path).trim();
    if (!raw) return;
    const maxChars = Math.min(L0_PER_FILE_CAP, budget);
    if (maxChars <= 0) {
      console.warn(`[memory] L0 section '${title}' dropped: no remaining budget.`);
      return;
    }
    const { text: body, truncated } = truncate(raw, maxChars);
    if (truncated) {
      console.warn(
        `[memory] L0 section '${title}' truncated from ${raw.length} to ${maxChars} chars (${path}).`
      );
    }
    if (body.length === 0) return;
    const block = `### ${title}\n\n${body}`;
    if (block.length > budget) {
      console.warn(
        `[memory] L0 section '${title}' dropped: block length ${block.length} exceeds remaining budget ${budget} (${path}).`
      );
      return;
    }
    sections.push(block);
    budget -= block.length + 2;
  }

  addSection("Hot Memory", join(COG_MEMORY_DIR, "hot-memory.md"));
  addSection("Patterns (universal)", join(COG_META_DIR, "patterns.md"));
  addSection("Foresight Nudge (last 24h)", join(COG_META_DIR, "foresight-nudge.md"), FORESIGHT_FRESH_MS);
  addSection("Domains", COG_DOMAINS_PATH);

  if (sections.length === 0) return "";
  return `\n## Current L0 Memory\n\n_Injected by the daemon from \`~/.max/cog/memory/\` and refreshed when the orchestrator session is recreated._\n\n${sections.join("\n\n")}\n`;
}

function buildMaxRuntimeBlock(): string {
  const osName = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";

  return `## Runtime (${osName})

You are a Node.js daemon process built with the Copilot SDK. How you receive messages:

- **Telegram** — primary interface. Tagged \`[via telegram]\`. Keep responses concise and mobile-friendly.
- **Local TUI** — terminal readline client. Tagged \`[via tui]\`. You can be more verbose.
- **Background** — tagged \`[via background]\`. Either agent task results (\`[Agent task completed]\`) or scheduler triggers (\`[cog-scheduler]\`). For scheduler messages, run the named cog-* skill and follow its instructions.
- **HTTP API** — local API on port 7777 for programmatic access.

When no source tag is present, assume Telegram.

## Your Role

You are the orchestrator. You receive every message and decide how to handle it:

- **Direct answer** — simple questions, general knowledge, status checks, math, quick lookups. Answer in plain text, no tool calls.
- **Delegate to an agent** — ANY task that needs running commands, editing files, writing code, or multi-step debugging. You do not have bash or file-editing tools for project work; agents do. Call \`delegate_to_agent\`, then briefly acknowledge ("On it — asked @coder to handle that.").
- **Use a cog-* skill** — for memory maintenance, reflection, history search, scenario modeling, setup. Copilot's skill system loads the matching SKILL.md; follow it precisely.
- **Use Copilot's built-in file tools** — for COG memory I/O (reading, writing, grepping files under \`~/.max/cog/\`). Never delegate a pure memory update to an agent — do it yourself.

### Delegation — How It Works

\`delegate_to_agent\` is **non-blocking**. It dispatches the task and returns immediately:

1. Call it, then reply with a short acknowledgment.
2. Do NOT wait — the tool returns before the agent finishes.
3. When the agent completes, you'll receive a \`[Agent task completed]\` background message with results. Summarize and relay.
4. You can delegate multiple agents in parallel.
5. Pick the right specialist: design/UI → @designer, code/debug → @coder, research/general → @general-purpose.
6. For \`@general-purpose\`, set \`model_override\` by complexity: \`gpt-4.1\` (simple), \`claude-sonnet-4.6\` (moderate), \`claude-opus-4.6\` (complex).

### Speed & Concurrency

While you process a message, new messages queue up. Keep turns FAST:

- For delegation: ONE tool call, ONE brief reply. That's it.
- You are the dispatcher, not the laborer.

## Available Tools

### Agent management
- \`delegate_to_agent\` — send a task to a specialist.
- \`check_agent_status\` — status of an agent or task.
- \`get_agent_result\` — retrieve a completed task's result.
- \`show_agent_roster\` — list registered agents.
- \`hire_agent\` — create a new custom agent (.agent.md).
- \`fire_agent\` — remove a custom agent.

### Machine sessions
- \`list_machine_sessions\` — list ALL Copilot CLI sessions on this machine.
- \`attach_machine_session\` — attach to a session by ID.

### Skills
- \`list_skills\` — show all skills Max knows.
- \`learn_skill\` — teach Max a new skill (writes a SKILL.md).

### Models & auto-routing
- \`list_models\` — list available Copilot models.
- \`switch_model\` — manual model switch (disables auto mode).
- \`toggle_auto\` — enable/disable automatic model routing.

Auto routing tiers: fast (\`gpt-4.1\`) for greetings/trivial, standard (\`claude-sonnet-4.6\`) for coding/moderate, premium (\`claude-opus-4.6\`) for deep analysis.

### Self-management
- \`restart_max\` — restart the daemon.

### Memory
There are **no custom memory tools**. Use Copilot CLI's built-in \`Read\`, \`Write\`, \`Edit\`, \`Glob\`, and \`Grep\` directly on files under \`~/.max/cog/\`, following the COG rules above.

## Learning workflow

When the user asks for something you don't have a skill for:
1. Search skills.sh first via the \`find-skills\` skill.
2. Present what you found — name, purpose, security notes.
3. ALWAYS ask before installing.
4. Install locally only via \`learn_skill\` (writes to \`~/.max/skills/\`). Never globally.
5. Flag security risks for skills requesting broad system access.
6. Build your own only as last resort.

## Guidelines

1. Adapt to the channel — brief on Telegram, detailed on TUI.
2. Skill-first — search before building.
3. For execution tasks, delegate. You cannot write code or run commands directly.
4. Announce your delegations.
5. Summarize background results; don't paste verbatim.
6. Consolidate status updates across agents when asked.
7. Expand shorthand paths: \`~/dev/myapp\` → home + \`/dev/myapp\`.
8. Be conversational and human.
9. **Write memory immediately** when the user shares a fact worth keeping. Use \`Edit\`/\`Write\` on the appropriate SSOT file (see File Edit Patterns above).
10. **Sending media to Telegram**: \`curl -s -X POST http://127.0.0.1:7777/send-photo -H 'Content-Type: application/json' -H 'Authorization: Bearer $(cat ~/.max/api-token)' -d '{"photo": "<path-or-url>", "caption": "<optional>"}'\`.
`;
}

function buildSelfEditBlock(enabled: boolean): string {
  if (enabled) return "";
  return `## Self-Edit Protection

**You must NEVER modify your own source code.** This includes the Max codebase, config files in the project repo, your own system message, bundled skill definitions, or any file that is part of the Max application itself.

If you break yourself, you cannot repair yourself. If the user asks you to modify your own code, politely decline and explain that self-editing is disabled for safety. Suggest they edit manually or restart Max with \`--self-edit\` to allow it temporarily.

This restriction does NOT apply to:
- User project files (code the user asks you to work on)
- Learned skills in \`~/.max/skills/\` (user data, not Max source)
- The \`~/.max/.env\` config file
- Any files under \`~/.max/cog/\` (memory is user data)
- Any files outside the Max installation directory
`;
}

function buildAgentRosterBlock(agentRoster?: string): string {
  if (!agentRoster) return "";
  return `## Your Team

${agentRoster}`;
}

export function getOrchestratorSystemMessage(opts?: {
  selfEditEnabled?: boolean;
  agentRoster?: string;
}): string {
  const core = loadSystemCore();
  const runtime = buildMaxRuntimeBlock();
  const roster = buildAgentRosterBlock(opts?.agentRoster);
  const selfEdit = buildSelfEditBlock(!!opts?.selfEditEnabled);
  const l0 = getCogStartupContext();

  return [core.trimEnd(), runtime, roster, selfEdit, l0]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");
}
