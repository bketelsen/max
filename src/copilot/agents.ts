import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync, copyFileSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { approveAll, type CopilotClient, type CopilotSession, type Tool } from "@github/copilot-sdk";
import { AGENTS_DIR, SESSIONS_DIR } from "../paths.js";
import { getDb, getState, setState } from "../store/db.js";
import { loadMcpConfig } from "./mcp-config.js";
import { getSkillDirectories } from "./skills.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  slug: string;
  name: string;
  description: string;
  model: string; // "auto" for dynamic model selection
  skills?: string[];
  tools?: string[]; // tool name allowlist; undefined = all execution tools
  mcpServers?: string[];
  systemMessage: string;
}

export interface AgentTaskInfo {
  taskId: string;
  agentSlug: string;
  description: string;
  status: "running" | "completed" | "error";
  result?: string;
  startedAt: number;
  completedAt?: number;
  originChannel?: string;
}

export interface AgentTaskSummary {
  taskId: string;
  description: string;
  status: AgentTaskInfo["status"];
  result?: string;
  startedAt: number;
  completedAt?: number;
  originChannel?: string;
}

export interface AgentStatusInfo {
  slug: string;
  name: string;
  description: string;
  model: string;
  runningTasks: AgentTaskSummary[];
  recentTasks: AgentTaskSummary[];
}

interface BuildEphemeralSessionRequestOptions {
  configDir: string;
  workingDirectory: string;
  mcpServers: ReturnType<typeof loadMcpConfig>;
  skillDirectories: string[];
  modelOverride?: string;
}

interface EnsureDefaultAgentsOptions {
  bundledDir?: string;
  logger?: Pick<Console, "warn">;
}

// Frontmatter schema
const agentFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().min(1),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

let agentRegistry: AgentConfig[] = [];

/** Bundled agents shipped with the package */
const BUNDLED_AGENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "agents"
);

const RESERVED_SLUGS = new Set(["max", "designer", "coder", "general-purpose"]);
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parse YAML frontmatter and markdown body from an .agent.md file. */
export function parseAgentMd(content: string, slug: string): AgentConfig | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\s*([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatterRaw = fmMatch[1];
  const body = fmMatch[2].trim();
  const parsed = parseAgentFrontmatter(frontmatterRaw);

  const result = agentFrontmatterSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[agents] Invalid frontmatter in ${slug}.agent.md:`, result.error.format());
    return null;
  }

  const fm = result.data;
  return {
    slug,
    name: fm.name,
    description: fm.description,
    model: fm.model,
    skills: fm.skills,
    tools: fm.tools,
    mcpServers: fm.mcpServers,
    systemMessage: body,
  };
}

/** Scan ~/.max/agents/ for .agent.md files and load configs. */
export function loadAgents(): AgentConfig[] {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true });
    return [];
  }

  const configs: AgentConfig[] = [];
  let entries: string[];
  try {
    entries = readdirSync(AGENTS_DIR);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.endsWith(".agent.md")) continue;
    const slug = entry.replace(/\.agent\.md$/, "");
    try {
      const content = readFileSync(join(AGENTS_DIR, entry), "utf-8");
      const config = parseAgentMd(content, slug);
      if (config) configs.push(config);
    } catch (err) {
      console.warn(`[agents] Failed to read ${entry}:`, err instanceof Error ? err.message : err);
    }
  }

  agentRegistry = configs;
  return configs;
}

/** Get agent config by name or slug (case-insensitive). */
export function getAgent(nameOrSlug: string): AgentConfig | undefined {
  const lower = nameOrSlug.toLowerCase();
  return agentRegistry.find(
    (a) => a.slug === lower || a.name.toLowerCase() === lower
  );
}

/** Get all loaded agent configs. */
export function getAgentRegistry(): AgentConfig[] {
  return [...agentRegistry];
}

export function resolveAgentModel(agent: AgentConfig, modelOverride?: string): string {
  if (modelOverride && modelOverride.length > 0) return modelOverride;
  return agent.model === "auto" ? "claude-sonnet-4.6" : agent.model;
}

/** Copy bundled agents to ~/.max/agents/, updating stale copies when the bundled version changes.
 *  Respects user customizations: if the user edited the deployed file after our last sync, we skip it. */
export function ensureDefaultAgents(options: EnsureDefaultAgentsOptions = {}): void {
  mkdirSync(AGENTS_DIR, { recursive: true });

  const bundledDir = options.bundledDir ?? BUNDLED_AGENTS_DIR;
  const logger = options.logger ?? console;

  if (!existsSync(bundledDir)) {
    logger.warn(`[agents] Bundled agents directory not found: ${bundledDir}`);
    return;
  }

  let bundled: string[];
  try {
    bundled = readdirSync(bundledDir).filter((f) => f.endsWith(".agent.md"));
  } catch {
    return;
  }

  for (const file of bundled) {
    const src = join(bundledDir, file);
    const dest = join(AGENTS_DIR, file);
    const srcHash = createHash("sha256").update(readFileSync(src)).digest("hex");
    const stateKey = `bundled_agent_hash:${file}`;

    if (!existsSync(dest)) {
      copyFileSync(src, dest);
      setState(stateKey, srcHash);
      console.log(`[agents] Installed bundled agent: ${file}`);
      continue;
    }

    // Check if the bundled version actually changed since our last sync
    const lastSyncedHash = getState(stateKey);
    if (lastSyncedHash === srcHash) continue; // bundled hasn't changed

    // Bundled version changed — only overwrite if the user hasn't customized it.
    // If we have a record of what we last deployed, check if the file still matches.
    const destHash = createHash("sha256").update(readFileSync(dest)).digest("hex");
    if (lastSyncedHash && destHash !== lastSyncedHash) {
      // User modified the file after our last sync — don't clobber their changes
      console.log(`[agents] Skipping ${file} — user has local customizations`);
      continue;
    }

    // Safe to update: either first sync (no record) or file is unmodified from our last deploy
    copyFileSync(src, dest);
    setState(stateKey, srcHash);
    console.log(`[agents] Updated bundled agent: ${file}`);
  }
}

function parseAgentFrontmatter(frontmatterRaw: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  const lines = frontmatterRaw.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^([^:#][^:]*):(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    const rawValue = match[2].trim();

    if (rawValue.length === 0) {
      const items: string[] = [];
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const itemMatch = lines[nextIndex].match(/^\s*-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(stripYamlQuotes(itemMatch[1].trim()));
        nextIndex++;
      }

      if (items.length > 0) {
        parsed[key] = items;
        index = nextIndex - 1;
      }
      continue;
    }

    const inlineArray = rawValue.match(/^\[(.*)\]$/);
    if (inlineArray) {
      parsed[key] = inlineArray[1]
        .split(",")
        .map((value) => stripYamlQuotes(value.trim()))
        .filter(Boolean);
      continue;
    }

    parsed[key] = stripYamlQuotes(rawValue);
  }

  return parsed;
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

/** Create a new agent .md file. Returns error string or null on success. */
export function createAgentFile(
  slug: string,
  name: string,
  description: string,
  model: string,
  systemPrompt: string,
  skills?: string[],
  tools?: string[]
): string | null {
  if (!SLUG_REGEX.test(slug)) {
    return `Invalid slug '${slug}': must be kebab-case (a-z0-9 with hyphens).`;
  }
  const filePath = join(AGENTS_DIR, `${slug}.agent.md`);
  if (!filePath.startsWith(AGENTS_DIR + "/")) {
    return `Invalid slug '${slug}': path traversal detected.`;
  }
  if (existsSync(filePath)) {
    return `Agent '${slug}' already exists. Edit it directly or remove it first.`;
  }

  // YAML value escaping for safe frontmatter
  const escapedName = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const escapedDesc = description.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

  let frontmatter = `---\nname: "${escapedName}"\ndescription: "${escapedDesc}"\nmodel: ${model}`;
  if (skills?.length) frontmatter += `\nskills:\n${skills.map((s) => `  - ${s}`).join("\n")}`;
  if (tools?.length) frontmatter += `\ntools:\n${tools.map((t) => `  - ${t}`).join("\n")}`;
  frontmatter += "\n---\n\n";

  writeFileSync(filePath, frontmatter + systemPrompt + "\n");
  return null;
}

/** Remove an agent .md file. Returns error string or null on success. */
export function removeAgentFile(slug: string): string | null {
  if (!SLUG_REGEX.test(slug)) {
    return `Invalid slug '${slug}'.`;
  }
  if (RESERVED_SLUGS.has(slug)) {
    return `Cannot remove built-in agent '${slug}'. You can edit its file instead.`;
  }
  const filePath = join(AGENTS_DIR, `${slug}.agent.md`);
  if (!filePath.startsWith(AGENTS_DIR + "/")) {
    return `Invalid slug '${slug}': path traversal detected.`;
  }
  if (!existsSync(filePath)) {
    return `Agent '${slug}' not found.`;
  }
  rmSync(filePath);
  return null;
}

// ---------------------------------------------------------------------------
// Agent Session Management
// ---------------------------------------------------------------------------

// Per-agent task tracking (in-memory, backed by DB)
const activeTasks = new Map<string, AgentTaskInfo>();
const recentTasksByAgent = new Map<string, AgentTaskInfo[]>();
const RECENT_TASK_CACHE_LIMIT = 5;
let taskCounter = 0;

function nextTaskId(): string {
  return `task-${++taskCounter}-${Date.now().toString(36)}`;
}

function toAgentTaskSummary(task: AgentTaskInfo): AgentTaskSummary {
  return {
    taskId: task.taskId,
    description: task.description,
    status: task.status,
    result: task.result,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    originChannel: task.originChannel,
  };
}

function cacheRecentTask(task: AgentTaskInfo): void {
  const recentTasks = recentTasksByAgent.get(task.agentSlug) ?? [];
  const nextRecentTasks = [
    { ...task },
    ...recentTasks.filter((entry) => entry.taskId !== task.taskId),
  ].slice(0, RECENT_TASK_CACHE_LIMIT);
  recentTasksByAgent.set(task.agentSlug, nextRecentTasks);
}

export function buildAgentStatusRoster(
  registry: AgentConfig[],
  tasks: AgentTaskInfo[],
  recentTasksCache: ReadonlyMap<string, AgentTaskInfo[]>
): AgentStatusInfo[] {
  return registry.map((agent) => {
    const runningTasks = tasks
      .filter((task) => task.agentSlug === agent.slug && task.status === "running")
      .sort((left, right) => right.startedAt - left.startedAt)
      .map(toAgentTaskSummary);
    const recentTasks = recentTasksCache.get(agent.slug) ?? [];

    return {
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      model: agent.model,
      runningTasks,
      recentTasks: recentTasks.map(toAgentTaskSummary),
    };
  });
}

export function getAgentStatusRoster(): AgentStatusInfo[] {
  return buildAgentStatusRoster(getAgentRegistry(), getActiveTasks(), recentTasksByAgent);
}

/** Shared base prompt injected into all agent sessions. */
function getAgentBasePrompt(): string {
  return `## Runtime Context

You are an agent within Max, a personal AI assistant for developers. You run on the user's local machine.

### Shared Memory — COG
All agents share COG, a filesystem-resident memory at \`~/.max/cog/\`. Persona, memory rules, and domain routing live in \`~/.max/cog/SYSTEM.md\`; read it if you need context on how memory is organized. Knowledge lives under \`~/.max/cog/memory/\` — domain files (\`personal/\`, \`work/<job>/\`), universal patterns (\`cog-meta/patterns.md\`), and archives (\`glacier/\`).

Use the built-in \`Read\`, \`Write\`, \`Edit\`, \`Glob\`, and \`Grep\` tools to read and update memory directly — there are no custom memory helpers. Follow the SSOT rule: each fact in one canonical file (\`entities.md\`, \`action-items.md\`, \`calendar.md\`, \`health.md\`); duplicates become \`[[wiki-links]]\`.

### Communication
- You receive tasks from @max (the orchestrator) or directly from the user.
- Your results are relayed back to the user by @max.
- To share knowledge with other agents, write to the appropriate COG memory file.

### Guidelines
- Be thorough but concise in your responses.
- Check COG for existing context before starting work — grep \`<!-- L0:\` headers across \`~/.max/cog/memory/\` to discover relevant files quickly.
- Save important findings to the canonical SSOT file. Add \`[[wiki-links]]\` from related files.
- Observations are append-only: \`- YYYY-MM-DD [tags]: <event>\` into the appropriate \`observations.md\`. Never edit past entries.
`;
}

/** Build the full system message for an agent. */
export function composeAgentSystemMessage(agent: AgentConfig, rosterInfo?: string): string {
  const base = getAgentBasePrompt();
  const agentPrompt = agent.systemMessage;

  // For @max, inject the agent roster
  if (agent.slug === "max" && rosterInfo) {
    return agentPrompt.replace("{agent_roster}", rosterInfo);
  }

  return `${agentPrompt}\n\n${base}`;
}

/** Build a roster description of all agents for @max's system prompt. */
export function buildAgentRoster(): string {
  const agents = getAgentRegistry();
  if (agents.length === 0) return "No agents registered.";

  return agents
    .filter((a) => a.slug !== "max")
    .map((a) => {
      const model = a.model === "auto" ? "dynamic (you choose)" : a.model;
      const skills = a.skills?.length ? ` | skills: ${a.skills.join(", ")}` : "";
      return `- **@${a.slug}** — ${a.description} (model: ${model}${skills})`;
    })
    .join("\n");
}

// Management tools that only @max should have
const MANAGEMENT_TOOL_NAMES = new Set([
  "delegate_to_agent", "check_agent_status", "get_agent_result",
  "show_agent_roster", "hire_agent", "fire_agent",
  "switch_model", "toggle_auto", "list_models",
  "restart_max", "list_skills", "learn_skill", "uninstall_skill",
  "list_machine_sessions", "attach_machine_session",
]);

/** Filter tools based on agent config. */
export function filterToolsForAgent(agent: AgentConfig, allTools: Tool<any>[]): Tool<any>[] {
  if (agent.tools && agent.tools.length > 0) {
    // Agent specifies an explicit allowlist — honor it verbatim. Memory I/O is
    // via Copilot's built-in Read/Edit/Write/Grep, not custom tools.
    const allowed = new Set(agent.tools);
    return allTools.filter((t) => allowed.has(t.name));
  }

  // Default: all tools except management (only @max gets those)
  if (agent.slug === "max") {
    return allTools;
  }
  return allTools.filter((t) => !MANAGEMENT_TOOL_NAMES.has(t.name));
}

export function buildEphemeralSessionRequest(
  agent: AgentConfig,
  tools: Tool<any>[],
  options: BuildEphemeralSessionRequestOptions
): Parameters<CopilotClient["createSession"]>[0] {
  return {
    model: resolveAgentModel(agent, options.modelOverride),
    configDir: options.configDir,
    workingDirectory: options.workingDirectory,
    // Delegated agent work only needs the final answer, so disable streaming to
    // avoid provider-side streaming parser failures on background tasks.
    streaming: false,
    systemMessage: { content: composeAgentSystemMessage(agent) },
    tools,
    mcpServers: options.mcpServers,
    skillDirectories: options.skillDirectories,
    onPermissionRequest: approveAll,
    infiniteSessions: {
      enabled: true,
      backgroundCompactionThreshold: 0.80,
      bufferExhaustionThreshold: 0.95,
    },
  };
}

/** Create an ephemeral session for an agent. Always creates a fresh session — caller is responsible for destroying it. */
export async function createEphemeralAgentSession(
  slug: string,
  client: CopilotClient,
  allTools: Tool<any>[],
  modelOverride?: string
): Promise<CopilotSession> {
  const agent = getAgent(slug);
  if (!agent) throw new Error(`Agent '${slug}' not found in registry.`);

  const model = resolveAgentModel(agent, modelOverride);
  const tools = filterToolsForAgent(agent, allTools);
  const mcpServers = loadMcpConfig();
  const skillDirectories = getSkillDirectories();

  const session = await client.createSession(buildEphemeralSessionRequest(agent, tools, {
    configDir: SESSIONS_DIR,
    workingDirectory: process.cwd(),
    mcpServers,
    skillDirectories,
    modelOverride,
  }));

  console.log(`[agents] Created ephemeral session for @${agent.slug} (${model})`);
  return session;
}

/** Clean up active task tracking (for shutdown/restart). */
export async function clearActiveTasks(): Promise<void> {
  activeTasks.clear();
  recentTasksByAgent.clear();
}

/** Remove all runtime and persisted task/session state for an agent. */
export function clearAgentState(slug: string): void {
  for (const [taskId, task] of activeTasks.entries()) {
    if (task.agentSlug === slug) {
      activeTasks.delete(taskId);
    }
  }
  recentTasksByAgent.delete(slug);

  const db = getDb();
  db.prepare(`DELETE FROM agent_tasks WHERE agent_slug = ?`).run(slug);
  db.prepare(`DELETE FROM agent_sessions WHERE slug = ?`).run(slug);
}

/** Get status info for an agent (task info only — no persistent sessions). */
export function getAgentSessionStatus(slug: string): {
  taskCount: number;
  tasks: AgentTaskInfo[];
} {
  const tasks = Array.from(activeTasks.values()).filter((t) => t.agentSlug === slug);
  return {
    taskCount: tasks.length,
    tasks,
  };
}

/** Get all active tasks. */
export function getActiveTasks(): AgentTaskInfo[] {
  return Array.from(activeTasks.values());
}

/** Get a task by ID. */
export function getTask(taskId: string): AgentTaskInfo | undefined {
  return activeTasks.get(taskId);
}

/** Register a new task. */
export function registerTask(
  agentSlug: string,
  description: string,
  originChannel?: string
): AgentTaskInfo {
  const task: AgentTaskInfo = {
    taskId: nextTaskId(),
    agentSlug,
    description,
    status: "running",
    startedAt: Date.now(),
    originChannel,
  };
  activeTasks.set(task.taskId, task);
  return task;
}

/** Mark a task as completed. */
export function completeTask(taskId: string, result: string): void {
  const task = activeTasks.get(taskId);
  if (task) {
    task.status = "completed";
    task.result = result;
    task.completedAt = Date.now();
    cacheRecentTask(task);
  }
}

/** Mark a task as failed. */
export function failTask(taskId: string, error: string): void {
  const task = activeTasks.get(taskId);
  if (task) {
    task.status = "error";
    task.result = error;
    task.completedAt = Date.now();
    cacheRecentTask(task);
  }
}

// ---------------------------------------------------------------------------
// @mention routing
// ---------------------------------------------------------------------------

/** Active agent per conversation channel (sticky routing). */
const activeAgentByChannel = new Map<string, string>();

/** Get the active agent for a channel. Returns "max" if none set. */
export function getActiveAgent(channel: string): string {
  return activeAgentByChannel.get(channel) || "max";
}

/** Set the active agent for a channel. */
export function setActiveAgent(channel: string, slug: string): void {
  activeAgentByChannel.set(channel, slug);
}

/** Parse @mention from message text. Returns agent slug and remaining message, or null. */
export function parseAtMention(text: string): { agentSlug: string; message: string } | null {
  const match = text.match(/^@([a-zA-Z0-9-]+)\s*([\s\S]*)$/);
  if (!match) return null;

  const mentionedName = match[1].toLowerCase();
  const message = match[2].trim();

  // Check if this matches a registered agent
  const agent = getAgent(mentionedName);
  if (!agent) return null;

  return { agentSlug: agent.slug, message: message || "" };
}
