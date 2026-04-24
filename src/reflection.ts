// ---------------------------------------------------------------------------
// Nightly Reflection Pipeline — COG-inspired conversation mining & memory update
//
// Runs as a CLI command (`max reflect`) or via systemd timer at 5 AM daily.
// Mines recent conversations, extracts observations, detects patterns,
// updates hot-memory, logs observations, and syncs entity pages.
// ---------------------------------------------------------------------------

import { approveAll, type CopilotClient, type CopilotSession } from "@github/copilot-sdk";
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { getDb, getState, setState, closeDb } from "./store/db.js";
import {
  ensureWikiStructure, readPage, writePage, readHotMemory, writeHotMemory,
  getWikiDir, writeFileAtomic,
} from "./wiki/fs.js";
import { addToIndex, parseIndex, searchIndex, type IndexEntry } from "./wiki/index-manager.js";
import { appendLog } from "./wiki/log-manager.js";
import { getClient, stopClient } from "./copilot/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObservationCategory = "fact" | "insight" | "decision" | "event" | "project" | "system";

export interface Observation {
  date: string;
  category: ObservationCategory;
  content: string;
  entity?: string;
  sourceId?: number; // conversation_log id for dedup
}

export interface Pattern {
  theme: string;
  observations: Observation[];
  frequency: number;
  lastSeen: string;
  suggestedAction?: "promote_priority" | "add_watch" | "update_entity" | "demote_stale";
}

export interface ReflectionReport {
  timestamp: string;
  conversationsMined: number;
  observationsExtracted: Observation[];
  patternsDetected: Pattern[];
  hotMemoryChanges: string[];
  entityPagesUpdated: string[];
  executionTimeMs: number;
  hotMemoryLines: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ReflectConfig {
  enabled: boolean;
  notifyTelegram: boolean;
  notifyOnErrorOnly: boolean;
  hours: number;
  patternThreshold: number;
}

export function getReflectConfig(): ReflectConfig {
  return {
    enabled: process.env.REFLECT_ENABLED !== "false",
    notifyTelegram: process.env.REFLECT_NOTIFY_TELEGRAM !== "false",
    notifyOnErrorOnly: process.env.REFLECT_NOTIFY_ON_ERROR_ONLY === "true",
    hours: parseInt(process.env.REFLECT_HOURS || "24", 10) || 24,
    patternThreshold: parseInt(process.env.REFLECT_PATTERN_THRESHOLD || "3", 10) || 3,
  };
}

// ---------------------------------------------------------------------------
// Cross-process lock (prevents concurrent reflection/housekeeping)
// ---------------------------------------------------------------------------

const LOCK_PATH = join(homedir(), ".max", "reflect.lock");

function acquireLock(): boolean {
  try {
    mkdirSync(dirname(LOCK_PATH), { recursive: true });
    // O_CREAT | O_EXCL — fails if file exists
    const fd = openSync(LOCK_PATH, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    // Check if the lock holder is still alive
    try {
      const pid = parseInt(readFileSync(LOCK_PATH, "utf-8").trim(), 10);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0); // Check if alive
          return false; // Lock holder is alive
        } catch {
          // Stale lock — remove and retry
          unlinkSync(LOCK_PATH);
          return acquireLock();
        }
      }
    } catch {
      // Can't read lock file — try to remove and retry once
      try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
      try {
        const fd = openSync(LOCK_PATH, "wx");
        writeFileSync(fd, String(process.pid));
        closeSync(fd);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function releaseLock(): void {
  try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// LLM-powered conversation mining
// ---------------------------------------------------------------------------

const MINING_MODEL = "gpt-4.1";
const MINING_TIMEOUT_MS = 60_000;

const MINING_SYSTEM_PROMPT = `You are an observation extractor for Max, a personal AI assistant. You analyze conversation logs and extract structured observations.

Extract meaningful observations from the conversation. Each observation should be a single, self-contained fact, insight, decision, event, project update, or system change.

Categories:
- fact: New information learned about the user, their work, or world
- insight: Realizations, patterns noticed, or valuable conclusions
- decision: Choices made or preferences expressed
- event: Things that happened or are upcoming
- project: Project updates, progress, milestones
- system: Technical changes, configuration, or tool updates

For each observation, identify the primary entity it relates to (a person, project, topic, or system). Use consistent entity names.

Respond with a JSON array only. No other text. Example:
[
  {"category": "project", "content": "Max Phase 1 memory enhancements deployed", "entity": "Max"},
  {"category": "decision", "content": "Burke chose to use COG-inspired memory patterns", "entity": "Max"},
  {"category": "event", "content": "Mother's Day is May 10, need to plan", "entity": "Mother's Day"}
]

Rules:
- Be specific and include names, dates, versions
- Skip trivial or duplicate observations
- Each observation should be 1-2 sentences max
- Entity names should be consistent (use same name for same thing)
- If no meaningful observations, return []`;

let miningSession: CopilotSession | undefined;

interface ConversationRow {
  id: number;
  role: string;
  content: string;
  source: string;
  ts: string;
}

async function ensureMiningSession(client: CopilotClient): Promise<CopilotSession> {
  if (miningSession) return miningSession;
  miningSession = await client.createSession({
    model: MINING_MODEL,
    streaming: false,
    systemMessage: { content: MINING_SYSTEM_PROMPT },
    onPermissionRequest: approveAll,
  });
  return miningSession;
}

function destroyMiningSession(): void {
  if (miningSession) {
    miningSession.destroy().catch(() => {});
    miningSession = undefined;
  }
}

/**
 * Mine conversations using checkpointed log IDs to avoid duplicates.
 * Falls back to time-based if no checkpoint exists.
 */
async function mineConversations(
  client: CopilotClient,
  hours: number,
): Promise<{ observations: Observation[]; sessionCount: number; lastLogId: number }> {
  const db = getDb();
  const lastReflectedId = parseInt(getState("last_reflected_log_id") || "0", 10);

  // Get turns since last reflection, with time-based fallback
  const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT id, role, content, source, ts FROM conversation_log
     WHERE id > ? AND ts >= ?
     ORDER BY id ASC
     LIMIT 500`
  ).all(lastReflectedId, cutoffDate) as ConversationRow[];

  if (rows.length === 0) {
    return { observations: [], sessionCount: 0, lastLogId: lastReflectedId };
  }

  const lastLogId = rows[rows.length - 1].id;

  // Count distinct "sessions" (gaps of 30+ min between messages)
  let sessionCount = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].ts).getTime();
    const curr = new Date(rows[i].ts).getTime();
    if (curr - prev > 30 * 60 * 1000) sessionCount++;
  }

  // Format for LLM
  const transcript = rows.map((r) => {
    const tag = r.role === "user" ? `[${r.source}] User` : r.role === "system" ? "[system]" : "Max";
    const content = r.content.length > 800 ? r.content.slice(0, 800) + "…" : r.content;
    return `${tag} (${r.ts}): ${content}`;
  }).join("\n");

  // Chunk if transcript is very long (>30k chars) — process in batches
  const MAX_CHUNK = 30_000;
  const chunks: string[] = [];
  if (transcript.length <= MAX_CHUNK) {
    chunks.push(transcript);
  } else {
    let start = 0;
    while (start < transcript.length) {
      chunks.push(transcript.slice(start, start + MAX_CHUNK));
      start += MAX_CHUNK;
    }
  }

  const allObservations: Observation[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const chunk of chunks) {
    try {
      const session = await ensureMiningSession(client);
      const result = await session.sendAndWait(
        { prompt: `Extract observations from these conversations:\n\n${chunk}` },
        MINING_TIMEOUT_MS,
      );

      const content = result?.data?.content || "";
      const parsed = parseObservationsFromLLM(content, today);
      allObservations.push(...parsed);
    } catch (err) {
      console.error(`[reflect] Mining error: ${err instanceof Error ? err.message : err}`);
      // Continue with what we have
    }
  }

  return { observations: allObservations, sessionCount, lastLogId };
}

function parseObservationsFromLLM(content: string, date: string): Observation[] {
  // Extract JSON array from response (may have markdown fences)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const raw = JSON.parse(jsonMatch[0]) as Array<{
      category?: string;
      content?: string;
      entity?: string;
    }>;

    const validCategories = new Set<ObservationCategory>(["fact", "insight", "decision", "event", "project", "system"]);

    return raw
      .filter((o) => o.content && typeof o.content === "string")
      .map((o) => ({
        date,
        category: (validCategories.has(o.category as ObservationCategory)
          ? o.category
          : "fact") as ObservationCategory,
        content: o.content!.trim(),
        entity: o.entity?.trim() || undefined,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pattern Detection
// ---------------------------------------------------------------------------

const OBSERVATIONS_PAGE = "pages/observations.md";
const PATTERN_LOOKBACK_DAYS = 30;

interface ParsedObservation {
  date: string;
  category: string;
  content: string;
  entity?: string;
}

function loadExistingObservations(days: number): ParsedObservation[] {
  const content = readPage(OBSERVATIONS_PAGE);
  if (!content) return [];

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const observations: ParsedObservation[] = [];
  // Format: - YYYY-MM-DD [category]: content (entity: X)
  const lineRegex = /^-\s+(\d{4}-\d{2}-\d{2})\s+\[(\w+)\]:\s+(.+?)(?:\s+\(entity:\s+(.+?)\))?$/;

  for (const line of content.split("\n")) {
    const m = line.match(lineRegex);
    if (m && m[1] >= cutoff) {
      observations.push({
        date: m[1],
        category: m[2],
        content: m[3].trim(),
        entity: m[4]?.trim(),
      });
    }
  }
  return observations;
}

function detectPatterns(
  newObservations: Observation[],
  threshold: number,
): Pattern[] {
  // Load existing observations for context
  const existing = loadExistingObservations(PATTERN_LOOKBACK_DAYS);

  // Combine all observations
  const all: Observation[] = [
    ...existing.map((o) => ({
      date: o.date,
      category: o.category as ObservationCategory,
      content: o.content,
      entity: o.entity,
    })),
    ...newObservations,
  ];

  // Cluster by entity
  const entityClusters = new Map<string, Observation[]>();
  for (const obs of all) {
    if (!obs.entity) continue;
    const key = obs.entity.toLowerCase();
    const list = entityClusters.get(key) || [];
    list.push(obs);
    entityClusters.set(key, list);
  }

  const patterns: Pattern[] = [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  for (const [entity, observations] of entityClusters) {
    if (observations.length < threshold) continue;

    // Find the canonical entity name (most common casing)
    const nameCounts = new Map<string, number>();
    for (const obs of observations) {
      if (obs.entity) {
        nameCounts.set(obs.entity, (nameCounts.get(obs.entity) || 0) + 1);
      }
    }
    const theme = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || entity;

    const lastSeen = observations
      .map((o) => o.date)
      .sort()
      .pop() || "";

    // Determine suggested action
    let suggestedAction: Pattern["suggestedAction"];
    const recentCount = observations.filter((o) => o.date >= sevenDaysAgo).length;

    if (recentCount === 0) {
      suggestedAction = "demote_stale";
    } else if (recentCount >= threshold) {
      suggestedAction = "promote_priority";
    } else {
      suggestedAction = "add_watch";
    }

    patterns.push({
      theme,
      observations,
      frequency: observations.length,
      lastSeen,
      suggestedAction,
    });
  }

  // Sort by frequency descending
  patterns.sort((a, b) => b.frequency - a.frequency);
  return patterns;
}

// ---------------------------------------------------------------------------
// Hot Memory Updates
// ---------------------------------------------------------------------------

const MAX_HOT_MEMORY_LINES = 50;

function updateHotMemory(patterns: Pattern[], dryRun: boolean): string[] {
  const changes: string[] = [];
  const hotMemory = readHotMemory();

  if (!hotMemory) {
    if (!dryRun) {
      // Create initial hot-memory with pattern insights
      const activePatterns = patterns.filter((p) => p.suggestedAction === "promote_priority").slice(0, 5);
      const watchPatterns = patterns.filter((p) => p.suggestedAction === "add_watch").slice(0, 5);

      if (activePatterns.length > 0 || watchPatterns.length > 0) {
        const lines = ["# Hot Memory", "", "## Active Priorities", ""];
        for (const p of activePatterns) {
          lines.push(`- ${p.theme} — ${p.frequency} observations, last ${p.lastSeen}`);
          changes.push(`Added "${p.theme}" to Active Priorities`);
        }
        lines.push("", "## Watch", "");
        for (const p of watchPatterns) {
          lines.push(`- ${p.theme} — ${p.frequency} observations`);
          changes.push(`Added "${p.theme}" to Watch`);
        }
        lines.push("");
        writeHotMemory(lines.join("\n"));
      }
    }
    return changes;
  }

  // Parse existing hot-memory sections
  const sections = parseHotMemorySections(hotMemory);

  // Apply pattern-based updates
  const priorities = sections.get("Active Priorities") || [];
  const watch = sections.get("Watch") || [];
  const systemNotes = sections.get("System Notes") || [];

  // Promote frequent patterns
  for (const p of patterns) {
    if (p.suggestedAction === "promote_priority") {
      const alreadyInPriorities = priorities.some((l) =>
        l.toLowerCase().includes(p.theme.toLowerCase())
      );
      if (!alreadyInPriorities) {
        // Check if in watch — move up
        const watchIdx = watch.findIndex((l) =>
          l.toLowerCase().includes(p.theme.toLowerCase())
        );
        if (watchIdx >= 0) {
          watch.splice(watchIdx, 1);
          changes.push(`Promoted "${p.theme}" from Watch to Active Priorities`);
        } else {
          changes.push(`Added "${p.theme}" to Active Priorities`);
        }
        priorities.push(`- ${p.theme} — ${p.frequency} mentions (active)`);
      } else {
        changes.push(`Kept "${p.theme}" in Active Priorities (${p.frequency} mentions)`);
      }
    } else if (p.suggestedAction === "add_watch") {
      const alreadyAnywhere = [...priorities, ...watch].some((l) =>
        l.toLowerCase().includes(p.theme.toLowerCase())
      );
      if (!alreadyAnywhere) {
        watch.push(`- ${p.theme} — ${p.frequency} mentions`);
        changes.push(`Added "${p.theme}" to Watch`);
      }
    } else if (p.suggestedAction === "demote_stale") {
      // Remove from priorities if stale
      const prioIdx = priorities.findIndex((l) =>
        l.toLowerCase().includes(p.theme.toLowerCase())
      );
      if (prioIdx >= 0) {
        priorities.splice(prioIdx, 1);
        changes.push(`Demoted stale "${p.theme}" from Active Priorities`);
      }
    }
  }

  // Add system observations to system notes
  for (const p of patterns) {
    const systemObs = p.observations.filter((o) => o.category === "system");
    if (systemObs.length > 0) {
      const alreadyNoted = systemNotes.some((l) =>
        l.toLowerCase().includes(p.theme.toLowerCase())
      );
      if (!alreadyNoted) {
        systemNotes.push(`- ${p.theme}: ${systemObs[0].content}`);
        changes.push(`Updated System Notes with "${p.theme}"`);
      }
    }
  }

  // Keep within line budget
  const limitSection = (items: string[], max: number) => {
    while (items.length > max) items.pop();
  };
  limitSection(priorities, 5);
  limitSection(watch, 10);
  limitSection(systemNotes, 5);

  // Rebuild hot-memory
  sections.set("Active Priorities", priorities);
  sections.set("Watch", watch);
  sections.set("System Notes", systemNotes);

  if (!dryRun && changes.length > 0) {
    const newContent = rebuildHotMemory(sections);
    // Enforce line limit
    const lines = newContent.split("\n");
    if (lines.length > MAX_HOT_MEMORY_LINES) {
      writeHotMemory(lines.slice(0, MAX_HOT_MEMORY_LINES).join("\n") + "\n");
    } else {
      writeHotMemory(newContent);
    }
  }

  return changes;
}

function parseHotMemorySections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentSection = "_header";
  sections.set(currentSection, []);

  for (const line of content.split("\n")) {
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      continue;
    }
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      sections.get(currentSection)?.push(line);
    }
  }
  return sections;
}

function rebuildHotMemory(sections: Map<string, string[]>): string {
  const lines: string[] = ["# Hot Memory", ""];

  // Preserve order: Active Priorities, Watch, System Notes, then others
  const orderedSections = ["Active Priorities", "Watch", "System Notes"];
  const done = new Set<string>(["_header"]);

  for (const name of orderedSections) {
    const items = sections.get(name);
    if (items && items.length > 0) {
      lines.push(`## ${name}`, "");
      lines.push(...items);
      lines.push("");
    }
    done.add(name);
  }

  // Any remaining sections
  for (const [name, items] of sections) {
    if (done.has(name) || items.length === 0) continue;
    lines.push(`## ${name}`, "");
    lines.push(...items);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Observation Logging
// ---------------------------------------------------------------------------

function logObservations(observations: Observation[], dryRun: boolean): void {
  if (dryRun || observations.length === 0) return;

  ensureWikiStructure();

  const existing = readPage(OBSERVATIONS_PAGE);
  const newLines = observations.map((o) => {
    const entitySuffix = o.entity ? ` (entity: ${o.entity})` : "";
    return `- ${o.date} [${o.category}]: ${o.content}${entitySuffix}`;
  });

  if (existing) {
    writePage(OBSERVATIONS_PAGE, existing.trimEnd() + "\n" + newLines.join("\n") + "\n");
  } else {
    const page = [
      "---",
      "title: Observations",
      "tags: [observations, reflection]",
      `created: ${new Date().toISOString().slice(0, 10)}`,
      `updated: ${new Date().toISOString().slice(0, 10)}`,
      "---",
      "",
      "<!-- L0: Append-only log of observations extracted by nightly reflection -->",
      "",
      "# Observations",
      "",
      "_Extracted by the reflection pipeline. Append-only._",
      "",
      ...newLines,
      "",
    ].join("\n");
    writePage(OBSERVATIONS_PAGE, page);
    addToIndex({
      path: OBSERVATIONS_PAGE,
      title: "Observations",
      summary: "Append-only log of observations extracted by nightly reflection",
      section: "System",
      tags: ["observations", "reflection"],
      updated: new Date().toISOString().slice(0, 10),
    });
  }

  // Update the index entry's updated date
  const entries = parseIndex();
  const obsEntry = entries.find((e) => e.path === OBSERVATIONS_PAGE);
  if (obsEntry) {
    obsEntry.updated = new Date().toISOString().slice(0, 10);
    addToIndex(obsEntry);
  }
}

// ---------------------------------------------------------------------------
// Entity Page Updates
// ---------------------------------------------------------------------------

function updateEntityPages(observations: Observation[], dryRun: boolean): string[] {
  if (dryRun || observations.length === 0) return [];

  const updated: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Group by entity
  const entityGroups = new Map<string, Observation[]>();
  for (const obs of observations) {
    if (!obs.entity) continue;
    const list = entityGroups.get(obs.entity) || [];
    list.push(obs);
    entityGroups.set(obs.entity, list);
  }

  for (const [entity, entityObs] of entityGroups) {
    const slug = entity.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) continue;

    // Try to find existing page
    const candidates = searchIndex(entity, 3);
    let pagePath = candidates.find((c) =>
      c.title.toLowerCase() === entity.toLowerCase() ||
      c.path.includes(`/${slug}.md`)
    )?.path;

    if (!pagePath) {
      // Determine category directory
      const category = entityObs[0].category;
      const dir = category === "project" ? "projects" : category === "system" ? "system" : "topics";
      pagePath = `pages/${dir}/${slug}.md`;
    }

    const existing = readPage(pagePath);
    const newBullets = entityObs.map((o) =>
      `- ${o.date} [${o.category}]: ${o.content}`
    );

    // Dedup: don't add bullets that already exist (by content substring)
    const existingContent = existing?.toLowerCase() || "";
    const uniqueBullets = newBullets.filter((b) => {
      const contentPart = b.split("]: ")[1]?.toLowerCase() || "";
      return contentPart.length > 0 && !existingContent.includes(contentPart);
    });

    if (uniqueBullets.length === 0) continue;

    if (existing) {
      // Append new observations
      const updatedContent = existing.replace(
        /^(---[\s\S]*?updated:\s*)[\d-]+/m,
        `$1${today}`
      );
      writePage(pagePath, updatedContent.trimEnd() + "\n\n## Reflection — " + today + "\n\n" + uniqueBullets.join("\n") + "\n");
    } else {
      // Create new page
      const page = [
        "---",
        `title: ${entity}`,
        `tags: [${entityObs[0].category}]`,
        `created: ${today}`,
        `updated: ${today}`,
        "related: []",
        "---",
        "",
        `<!-- L0: Auto-created by reflection for entity "${entity}" -->`,
        "",
        `# ${entity}`,
        "",
        ...uniqueBullets,
        "",
      ].join("\n");
      writePage(pagePath, page);
    }

    addToIndex({
      path: pagePath,
      title: entity,
      summary: `${uniqueBullets.length} observations from reflection`,
      section: "Knowledge",
      tags: [entityObs[0].category],
      updated: today,
    });

    updated.push(pagePath);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

function generateReport(report: ReflectionReport): string {
  const ts = new Date(report.timestamp).toISOString().replace("T", " ").slice(0, 19);
  const lines: string[] = [
    `# Reflection Report — ${ts}`,
    "",
    "## Conversations Mined",
    `- ${report.conversationsMined} sessions from last ${report.dryRun ? "N/A (dry-run)" : "24"} hours`,
    "",
    "## Observations Extracted",
    "",
  ];

  // Group observations by category
  const byCategory = new Map<string, Observation[]>();
  for (const obs of report.observationsExtracted) {
    const list = byCategory.get(obs.category) || [];
    list.push(obs);
    byCategory.set(obs.category, list);
  }

  for (const [category, obs] of byCategory) {
    lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    for (const o of obs) {
      lines.push(`- ${o.date} [${o.category}]: ${o.content}${o.entity ? ` (${o.entity})` : ""}`);
    }
    lines.push("");
  }

  lines.push("## Patterns Detected", "");
  if (report.patternsDetected.length === 0) {
    lines.push("_No patterns detected._", "");
  } else {
    for (const p of report.patternsDetected) {
      const actionLabel = p.suggestedAction?.replace(/_/g, " ") || "none";
      lines.push(`### Pattern: "${p.theme}" (${actionLabel})`);
      lines.push(`- ${p.frequency} observations, last seen ${p.lastSeen}`);
      lines.push(`- Action: ${actionLabel}`, "");
    }
  }

  lines.push("## Hot Memory Changes", "");
  if (report.hotMemoryChanges.length === 0) {
    lines.push("_No changes to hot memory._", "");
  } else {
    for (let i = 0; i < report.hotMemoryChanges.length; i++) {
      lines.push(`${i + 1}. ${report.hotMemoryChanges[i]}`);
    }
    lines.push("");
  }

  lines.push("## Entity Pages Updated", "");
  if (report.entityPagesUpdated.length === 0) {
    lines.push("_No entity pages updated._", "");
  } else {
    for (const p of report.entityPagesUpdated) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  lines.push("## Summary", "");
  lines.push(`- Execution time: ${(report.executionTimeMs / 1000).toFixed(1)}s`);
  lines.push(`- Hot memory size: ${report.hotMemoryLines} lines (target: <${MAX_HOT_MEMORY_LINES})`);
  lines.push(`- Observations logged: ${report.observationsExtracted.length}`);
  lines.push(`- Patterns found: ${report.patternsDetected.length}`);
  lines.push(`- Wiki pages updated: ${report.entityPagesUpdated.length}`);
  if (report.dryRun) lines.push(`- Mode: DRY RUN (no changes made)`);
  lines.push("");

  return lines.join("\n");
}

function saveReport(report: ReflectionReport): string {
  const today = new Date().toISOString().slice(0, 10);
  const filename = `reflect-${today}.log`;
  const fullPath = join(getWikiDir(), filename);
  const content = generateReport(report);
  writeFileAtomic(fullPath, content);
  return fullPath;
}

// ---------------------------------------------------------------------------
// Telegram Notification (direct HTTP — works without running bot)
// ---------------------------------------------------------------------------

async function sendTelegramNotification(report: ReflectionReport): Promise<void> {
  const cfg = getReflectConfig();
  if (!cfg.notifyTelegram) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.AUTHORIZED_USER_ID;
  if (!token || !chatId) return;

  // Skip notification if configured for errors only and no errors occurred
  if (cfg.notifyOnErrorOnly && report.observationsExtracted.length > 0) return;

  const ts = new Date(report.timestamp).toISOString().replace("T", " ").slice(0, 16);
  const today = new Date().toISOString().slice(0, 10);

  let text = `🧠 Nightly Reflection (${ts})\n\n`;
  text += `Insights from last ${cfg.hours} hours:\n\n`;
  text += `📝 ${report.observationsExtracted.length} observations extracted\n`;

  if (report.patternsDetected.length > 0) {
    text += `🔍 ${report.patternsDetected.length} patterns detected:\n`;
    for (const p of report.patternsDetected.slice(0, 5)) {
      const action = p.suggestedAction === "promote_priority" ? "active"
        : p.suggestedAction === "demote_stale" ? "stale"
        : "watching";
      text += `  • "${p.theme}" — ${p.frequency} mentions (${action})\n`;
    }
  } else {
    text += `🔍 No patterns detected\n`;
  }

  if (report.hotMemoryChanges.length > 0) {
    text += `\n🔄 Hot memory updated:\n`;
    for (const c of report.hotMemoryChanges.slice(0, 5)) {
      text += `  • ${c}\n`;
    }
  }

  if (report.entityPagesUpdated.length > 0) {
    text += `\n📄 ${report.entityPagesUpdated.length} entity pages updated\n`;
  }

  text += `\nFull report: ~/.max/wiki/reflect-${today}.log`;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) {
      console.error(`[reflect] Telegram notification failed: ${response.status}`);
    }
  } catch (err) {
    console.error(`[reflect] Telegram notification error: ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runReflection(
  dryRun = false,
  hours?: number,
): Promise<ReflectionReport> {
  const cfg = getReflectConfig();
  const effectiveHours = hours ?? cfg.hours;
  const startTime = Date.now();

  console.log(`[reflect] Starting reflection (dryRun=${dryRun}, hours=${effectiveHours})…`);

  if (!cfg.enabled && !dryRun) {
    console.log("[reflect] Reflection is disabled (REFLECT_ENABLED=false).");
    return {
      timestamp: new Date().toISOString(),
      conversationsMined: 0,
      observationsExtracted: [],
      patternsDetected: [],
      hotMemoryChanges: [],
      entityPagesUpdated: [],
      executionTimeMs: 0,
      hotMemoryLines: 0,
      dryRun,
    };
  }

  // Acquire cross-process lock
  if (!dryRun && !acquireLock()) {
    throw new Error("Could not acquire reflection lock — another reflection may be running.");
  }

  try {
    ensureWikiStructure();

    // Mark in-progress for crash recovery
    if (!dryRun) {
      setState("reflect_in_progress", "true");
    }

    // 1. Mine conversations
    console.log("[reflect] Mining conversations…");
    const client = await getClient();
    const { observations, sessionCount, lastLogId } = await mineConversations(client, effectiveHours);
    console.log(`[reflect] Extracted ${observations.length} observations from ${sessionCount} sessions`);

    // 2. Detect patterns
    console.log("[reflect] Detecting patterns…");
    const patterns = detectPatterns(observations, cfg.patternThreshold);
    console.log(`[reflect] Found ${patterns.length} patterns`);

    // 3. Update hot memory
    console.log("[reflect] Updating hot memory…");
    const hotMemoryChanges = updateHotMemory(patterns, dryRun);

    // 4. Log observations
    console.log("[reflect] Logging observations…");
    logObservations(observations, dryRun);

    // 5. Update entity pages
    console.log("[reflect] Updating entity pages…");
    const entityPagesUpdated = updateEntityPages(observations, dryRun);

    // Calculate hot memory size
    const hotMemory = readHotMemory();
    const hotMemoryLines = hotMemory ? hotMemory.split("\n").length : 0;

    const report: ReflectionReport = {
      timestamp: new Date().toISOString(),
      conversationsMined: sessionCount,
      observationsExtracted: observations,
      patternsDetected: patterns,
      hotMemoryChanges,
      entityPagesUpdated,
      executionTimeMs: Date.now() - startTime,
      hotMemoryLines,
      dryRun,
    };

    // 6. Save report
    if (!dryRun) {
      const reportPath = saveReport(report);
      console.log(`[reflect] Report saved to ${reportPath}`);
      appendLog("update", `reflection: ${observations.length} observations, ${patterns.length} patterns, ${entityPagesUpdated.length} pages updated`);

      // Advance checkpoint
      if (lastLogId > 0) {
        setState("last_reflected_log_id", String(lastLogId));
      }
      setState("reflect_in_progress", "");
    }

    // 7. Telegram notification
    if (!dryRun) {
      await sendTelegramNotification(report);
    }

    console.log(`[reflect] Reflection complete in ${(report.executionTimeMs / 1000).toFixed(1)}s`);
    return report;
  } finally {
    // Clean up
    destroyMiningSession();
    if (!dryRun) releaseLock();
  }
}

/**
 * CLI entry point — handles process lifecycle (client teardown, db close, exit).
 */
export async function runReflectionCli(dryRun: boolean, hours: number): Promise<void> {
  try {
    const report = await runReflection(dryRun, hours);

    console.log("");
    console.log("Reflection complete:");
    console.log(`  Conversations mined:   ${report.conversationsMined}`);
    console.log(`  Observations extracted: ${report.observationsExtracted.length}`);
    console.log(`  Patterns detected:     ${report.patternsDetected.length}`);
    console.log(`  Hot memory changes:    ${report.hotMemoryChanges.length}`);
    console.log(`  Entity pages updated:  ${report.entityPagesUpdated.length}`);
    console.log(`  Execution time:        ${(report.executionTimeMs / 1000).toFixed(1)}s`);
    console.log(`  Hot memory lines:      ${report.hotMemoryLines}/${MAX_HOT_MEMORY_LINES}`);
    if (dryRun) console.log("  Mode: DRY RUN (no changes made)");
  } catch (err) {
    console.error(`Reflection failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  } finally {
    await stopClient();
    closeDb();
  }
}
