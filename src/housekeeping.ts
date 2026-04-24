// ---------------------------------------------------------------------------
// Automated wiki housekeeping — keeps Max's memory system healthy.
//
// Operations:
//   1. Hot memory pruning — move stale items to domain pages
//   2. Observation archival — archive old entries (Phase 3 prep)
//   3. Wiki link audit — find/fix broken [[links]]
//   4. Stale L0 detection — flag pages with outdated summaries
//   5. Index rebuild — regenerate index.md from disk
// ---------------------------------------------------------------------------

import { existsSync, statSync, mkdirSync, openSync, closeSync, writeFileSync as writeFileSyncNode, unlinkSync as unlinkSyncNode } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { config as loadEnv } from "dotenv";
import { WIKI_DIR, WIKI_PAGES_DIR, DB_PATH, MAX_HOME, ENV_PATH } from "./paths.js";
import {
  readPage,
  writePage,
  listPages,
  readHotMemory,
  writeHotMemory,
  pageExists,
  writeFileAtomic,
  readIndexFile,
  ensureWikiStructure,
} from "./wiki/fs.js";
import {
  rebuildIndexFromPages,
  extractL0,
  parseIndex,
} from "./wiki/index-manager.js";
import { appendLog } from "./wiki/log-manager.js";

// Load env vars from ~/.max/.env (same as config.ts but without full schema parse)
loadEnv({ path: ENV_PATH });
loadEnv();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HousekeepingReport {
  timestamp: string;
  hotMemory: {
    itemsMoved: Array<{ item: string; destination: string; reason: string }>;
    itemsKept: number;
    finalLineCount: number;
  };
  observations: {
    archived: number;
    archivePath?: string;
  };
  links: {
    fixed: Array<{ page: string; from: string; to: string }>;
    broken: Array<{ page: string; link: string }>;
  };
  staleL0s: Array<{ page: string; reason: string }>;
  indexRebuilt: boolean;
  indexPageCount: number;
  executionTimeMs: number;
  errors: string[];
}

export interface HousekeepingOptions {
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const LOCKFILE_PATH = join(MAX_HOME, "housekeeping.lock");

/**
 * Acquire a cross-process advisory lock using a lockfile.
 * Returns a release function, or throws if another process holds the lock.
 */
function acquireLock(): () => void {
  mkdirSync(dirname(LOCKFILE_PATH), { recursive: true });
  // Check for stale lockfile (older than 10 minutes = likely dead process)
  if (existsSync(LOCKFILE_PATH)) {
    try {
      const stat = statSync(LOCKFILE_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 600_000) {
        throw new Error(
          "Another housekeeping process is running (lockfile exists and is recent). " +
          "If this is stale, delete: " + LOCKFILE_PATH
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Another housekeeping")) throw err;
      // Can't stat — try to proceed
    }
  }

  const fd = openSync(LOCKFILE_PATH, "w");
  writeFileSyncNode(fd, `pid=${process.pid}\ntime=${new Date().toISOString()}\n`);
  closeSync(fd);

  return () => {
    try {
      unlinkSyncNode(LOCKFILE_PATH);
    } catch { /* best-effort cleanup */ }
  };
}

export async function runHousekeeping(
  options: HousekeepingOptions = {}
): Promise<HousekeepingReport> {
  const start = Date.now();
  const { dryRun = false } = options;

  ensureWikiStructure();

  // Acquire cross-process lock (protects against daemon + oneshot racing)
  let releaseLock: (() => void) | undefined;
  if (!dryRun) {
    releaseLock = acquireLock();
  }

  const report: HousekeepingReport = {
    timestamp: new Date().toISOString(),
    hotMemory: { itemsMoved: [], itemsKept: 0, finalLineCount: 0 },
    observations: { archived: 0 },
    links: { fixed: [], broken: [] },
    staleL0s: [],
    indexRebuilt: false,
    indexPageCount: 0,
    executionTimeMs: 0,
    errors: [],
  };

  try {
    try {
      await pruneHotMemory(report, dryRun);
    } catch (err) {
      report.errors.push(`Hot memory pruning failed: ${errorMessage(err)}`);
    }

    try {
      await archiveObservations(report, dryRun);
    } catch (err) {
      report.errors.push(`Observation archival failed: ${errorMessage(err)}`);
    }

    try {
      auditWikiLinks(report, dryRun);
    } catch (err) {
      report.errors.push(`Wiki link audit failed: ${errorMessage(err)}`);
    }

    try {
      detectStaleL0s(report);
    } catch (err) {
      report.errors.push(`Stale L0 detection failed: ${errorMessage(err)}`);
    }

    try {
      if (!dryRun) {
        rebuildIndexFromPages();
        report.indexRebuilt = true;
      }
      // Exclude archive pages from the count
      report.indexPageCount = listPages().filter(
        (p) => !p.startsWith("pages/archive/")
      ).length;
    } catch (err) {
      report.errors.push(`Index rebuild failed: ${errorMessage(err)}`);
    }

    report.executionTimeMs = Date.now() - start;

    // Save report
    const reportPath = getReportPath();
    const reportContent = formatReport(report, dryRun);
    if (!dryRun) {
      writeFileAtomic(reportPath, reportContent);
      appendLog("reorg", `Housekeeping complete: ${summarizeReport(report)}`);
    }

    // Send Telegram notification if enabled
    if (!dryRun) {
      await sendNotification(report).catch((err) => {
        report.errors.push(`Telegram notification failed: ${errorMessage(err)}`);
      });
    }
  } finally {
    releaseLock?.();
  }

  return report;
}

// ---------------------------------------------------------------------------
// 1. Hot Memory Pruning
// ---------------------------------------------------------------------------

/** Keywords to extract from a bullet for conversation search. */
function extractKeywords(bullet: string): string[] {
  // Strip markdown formatting and common prefixes
  const clean = bullet
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .toLowerCase();

  // Extract meaningful words (3+ chars, skip stop words)
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
    "was", "one", "our", "out", "day", "had", "hot", "how", "its", "may",
    "new", "now", "old", "see", "way", "who", "did", "get", "let", "say",
    "she", "too", "use", "with", "this", "that", "from", "have", "will",
    "been", "each", "make", "like", "just", "over", "such", "take", "than",
    "them", "very", "when", "what", "your", "about", "would", "there",
    "their", "which", "could", "other", "into", "some", "time", "keep",
    "move", "still", "also",
  ]);

  return clean
    .split(/[\s,;:!?()[\]{}'"]+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 8); // Limit to avoid overly broad queries
}

/** Check if any keywords appear in recent user messages in conversation_log (last N days). */
function isReferencedRecently(keywords: string[], days: number): boolean {
  if (keywords.length === 0) return false;

  try {
    if (!existsSync(DB_PATH)) return false;
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });

    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      // Only check user messages to avoid false positives from assistant echoes
      for (const kw of keywords) {
        const row = db
          .prepare(
            `SELECT 1 FROM conversation_log WHERE ts > ? AND role = 'user' AND content LIKE ? LIMIT 1`
          )
          .get(cutoff, `%${kw}%`);
        if (row) return true;
      }
      return false;
    } finally {
      db.close();
    }
  } catch {
    // If DB isn't available, assume referenced (safe default)
    return true;
  }
}

/** Determine where a stale hot-memory item should be moved. */
function classifyItem(bullet: string): { page: string; section: string } {
  const lower = bullet.toLowerCase();

  // Identity/personal facts
  if (
    /\b(brian|burke|bjk|name|identity|family|wife|son|daughter)\b/.test(lower)
  ) {
    return { page: "pages/facts/brian.md", section: "Knowledge" };
  }

  // System/technical notes
  if (
    /\b(system|config|setup|install|server|daemon|service|deploy)\b/.test(lower)
  ) {
    return { page: "pages/system-state.md", section: "Knowledge" };
  }

  // Project references
  const projectMatch = lower.match(
    /\b(miles|siona|aspens?|forge|frostyard|max|cog|nanoclaw|companion|toolbox|claudekit|cmdgen|hve|piclaw)\b/
  );
  if (projectMatch) {
    // Use the matched name directly (don't strip trailing 's')
    const projectSlug = projectMatch[1];
    return {
      page: `pages/projects/${projectSlug}.md`,
      section: "Projects",
    };
  }

  // Default: routines/general
  return { page: "pages/routines.md", section: "Knowledge" };
}

/** Check if item should always be kept (has watch marker or future date). */
function shouldKeep(bullet: string): boolean {
  // Explicit watch/pin markers
  if (/\b(watch|pin|pinned|keep|always)\b/i.test(bullet)) {
    return true;
  }

  // ISO-style future dates (YYYY-MM-DD)
  const isoDateMatch = bullet.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDateMatch) {
    const date = new Date(isoDateMatch[1]);
    if (date.getTime() > Date.now()) return true;
  }

  // Natural-language future dates: "May 10", "June 2026", etc.
  const MONTHS: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };

  const naturalDate = bullet.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (naturalDate) {
    const monthNum = MONTHS[naturalDate[1].toLowerCase()];
    const day = parseInt(naturalDate[2], 10);
    const year = naturalDate[3] ? parseInt(naturalDate[3], 10) : new Date().getFullYear();
    if (monthNum !== undefined) {
      const date = new Date(year, monthNum, day);
      // If the date has already passed this year but no year was specified,
      // assume it's still relevant if within the last month
      if (date.getTime() > Date.now() - 30 * 86400000) return true;
    }
  }

  return false;
}

/** Sections in hot-memory that should never be pruned (core identity/context). */
const PINNED_SECTIONS = new Set([
  "identity",
  "who i am",
  "who you are",
  "core context",
  "core",
  "system",
  "system notes",
  "communication",
  "communication style",
  "operating context",
  "watch",
]);

/** Returns true if a line is a list item (bullet or numbered). */
function isListItem(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("- ") ||
    trimmed.startsWith("* ") ||
    /^\d+\.\s/.test(trimmed)
  );
}

async function pruneHotMemory(
  report: HousekeepingReport,
  dryRun: boolean
): Promise<void> {
  const content = readHotMemory();
  if (!content) return;

  const lines = content.split("\n");
  const keptLines: string[] = [];
  const movedItems: typeof report.hotMemory.itemsMoved = [];

  // Track current section to detect pinned sections
  let currentSection = "";
  let inPinnedSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section headers
    const sectionMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase().trim();
      inPinnedSection = PINNED_SECTIONS.has(currentSection);
      keptLines.push(line);
      continue;
    }

    // Keep non-list-item lines (blank lines, comments, frontmatter)
    if (!isListItem(trimmed)) {
      keptLines.push(line);
      continue;
    }

    // Always keep items in pinned sections
    if (inPinnedSection) {
      keptLines.push(line);
      continue;
    }

    // Always keep watch/pinned/future-dated items
    if (shouldKeep(trimmed)) {
      keptLines.push(line);
      continue;
    }

    // Check if referenced in last 7 days
    const keywords = extractKeywords(trimmed);
    if (isReferencedRecently(keywords, 7)) {
      keptLines.push(line);
      continue;
    }

    // This item is stale — classify and move
    const { page } = classifyItem(trimmed);
    movedItems.push({
      item: trimmed.slice(0, 100) + (trimmed.length > 100 ? "…" : ""),
      destination: page,
      reason: "Not referenced in last 7 days",
    });

    if (!dryRun) {
      appendToPage(page, trimmed);
    }
  }

  report.hotMemory.itemsMoved = movedItems;
  report.hotMemory.itemsKept = keptLines.filter((l) => isListItem(l.trim())).length;

  if (!dryRun && movedItems.length > 0) {
    // Clean up trailing blank lines
    const cleaned = keptLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n";
    writeHotMemory(cleaned);
  }

  report.hotMemory.finalLineCount = keptLines.length;
}

/** Append a bullet item to a wiki page, creating it if needed. */
function appendToPage(pagePath: string, bullet: string): void {
  const existing = readPage(pagePath);
  if (existing) {
    // Avoid duplicates
    if (existing.includes(bullet)) return;
    writePage(pagePath, existing.trimEnd() + "\n" + bullet + "\n");
  } else {
    // Create the page
    const title = pagePath
      .split("/")
      .pop()!
      .replace(".md", "")
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    const now = new Date().toISOString().slice(0, 10);
    const content = [
      "---",
      `title: ${title}`,
      `updated: ${now}`,
      "---",
      "",
      `<!-- L0: Items moved here by housekeeping -->`,
      "",
      `# ${title}`,
      "",
      bullet,
      "",
    ].join("\n");
    mkdirSync(dirname(join(WIKI_DIR, pagePath)), { recursive: true });
    writePage(pagePath, content);
  }
}

// ---------------------------------------------------------------------------
// 2. Observation Archival
// ---------------------------------------------------------------------------

async function archiveObservations(
  report: HousekeepingReport,
  dryRun: boolean
): Promise<void> {
  const obsPath = "pages/observations.md";
  const content = readPage(obsPath);
  if (!content) return;

  const lines = content.split("\n");
  if (lines.length <= 500) return;

  const cutoff = new Date(Date.now() - 90 * 86400000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const archiveMonth = cutoff.toISOString().slice(0, 7); // YYYY-MM

  const kept: string[] = [];
  const archived: string[] = [];
  let inHeader = true;

  for (const line of lines) {
    // Keep frontmatter and headers
    if (inHeader && (line.startsWith("---") || line.startsWith("#") || !line.trim())) {
      if (line.startsWith("# ") && !line.startsWith("---")) {
        inHeader = false;
      }
      kept.push(line);
      continue;
    }
    inHeader = false;

    // Try to extract date from line
    const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (dateMatch && dateMatch[1] < cutoffStr) {
      archived.push(line);
    } else {
      kept.push(line);
    }
  }

  if (archived.length === 0) return;

  report.observations.archived = archived.length;
  const archivePath = `pages/archive/observations-${archiveMonth}.md`;
  report.observations.archivePath = archivePath;

  if (!dryRun) {
    // Create archive page
    const archiveDir = join(WIKI_PAGES_DIR, "archive");
    mkdirSync(archiveDir, { recursive: true });

    const existingArchive = readPage(archivePath);
    if (existingArchive) {
      writePage(
        archivePath,
        existingArchive.trimEnd() + "\n" + archived.join("\n") + "\n"
      );
    } else {
      const archiveContent = [
        "---",
        `title: Observation Archive ${archiveMonth}`,
        `updated: ${new Date().toISOString().slice(0, 10)}`,
        "---",
        "",
        `<!-- L0: Archived observations from ${archiveMonth} -->`,
        "",
        `# Observation Archive — ${archiveMonth}`,
        "",
        ...archived,
        "",
      ].join("\n");
      writePage(archivePath, archiveContent);
    }

    // Rewrite observations with only kept lines
    writePage(obsPath, kept.join("\n"));
  }
}

// ---------------------------------------------------------------------------
// 3. Wiki Link Audit
// ---------------------------------------------------------------------------

/** Common typo fixes for wiki links. */
const LINK_FIXES: Array<[RegExp, string]> = [
  [/^project\//, "projects/"],
  [/^people\//, "people/"],    // Already correct, but normalize
  [/^fact\//, "facts/"],
  [/^routine\//, "routines/"],
  [/^preference\//, "preferences/"],
  [/^decision\//, "decisions/"],
];

function auditWikiLinks(report: HousekeepingReport, dryRun: boolean): void {
  const pages = listPages();
  // Also check hot-memory.md and index.md
  const allFiles = [...pages, "hot-memory.md"];

  for (const pagePath of allFiles) {
    const content = readPage(pagePath);
    if (!content) continue;

    // Find all [[link]] patterns
    const linkPattern = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    let modified = content;
    let wasModified = false;

    while ((match = linkPattern.exec(content)) !== null) {
      const rawLink = match[1].trim();

      // Normalize: add .md extension and pages/ prefix if missing
      let resolved = rawLink;
      if (!resolved.endsWith(".md")) resolved += ".md";
      if (!resolved.startsWith("pages/") && !resolved.startsWith("hot-memory")) {
        resolved = "pages/" + resolved;
      }

      // Try auto-fixes
      let fixed = resolved;
      for (const [pattern, replacement] of LINK_FIXES) {
        const withoutPrefix = fixed.replace(/^pages\//, "");
        if (pattern.test(withoutPrefix)) {
          fixed = "pages/" + withoutPrefix.replace(pattern, replacement);
          break;
        }
      }

      if (fixed !== resolved && pageExists(fixed)) {
        // Auto-fix worked
        const fixedLink = fixed.replace(/^pages\//, "").replace(/\.md$/, "");
        report.links.fixed.push({
          page: pagePath,
          from: rawLink,
          to: fixedLink,
        });
        if (!dryRun) {
          modified = modified.replace(`[[${rawLink}]]`, `[[${fixedLink}]]`);
          wasModified = true;
        }
      } else if (!pageExists(fixed) && !pageExists(resolved)) {
        report.links.broken.push({ page: pagePath, link: rawLink });
      }
    }

    if (wasModified && !dryRun) {
      writePage(pagePath, modified);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Stale L0 Detection
// ---------------------------------------------------------------------------

function detectStaleL0s(report: HousekeepingReport): void {
  const pages = listPages();

  for (const pagePath of pages) {
    const content = readPage(pagePath);
    if (!content) continue;

    const l0 = extractL0(content);
    if (!l0) {
      // No L0 at all — flag it if the page has meaningful content
      const body = content.replace(/^---[\s\S]*?---\s*/, "").trim();
      if (body.split("\n").length > 5) {
        report.staleL0s.push({
          page: pagePath,
          reason: "Missing L0 summary",
        });
      }
      continue;
    }

    // Check if L0 is too short relative to page content
    const body = content
      .replace(/^---[\s\S]*?---\s*/, "")
      .replace(/^<!--\s*L0:.*-->\s*\n?/, "")
      .trim();
    const bodyLines = body.split("\n").filter((l) => l.trim().length > 0);
    const l0Words = l0.split(/\s+/).length;
    const bodyWords = body.split(/\s+/).length;

    // Heuristic: if body has grown significantly (>3x what L0 describes)
    // and page is large enough to matter
    if (bodyLines.length > 15 && bodyWords > l0Words * 10) {
      report.staleL0s.push({
        page: pagePath,
        reason: `L0 may be outdated (${l0Words} words summarizing ${bodyWords} words)`,
      });
      continue;
    }

    // Check file modification time vs a staleness threshold
    try {
      const fullPath = join(WIKI_DIR, pagePath);
      const stat = statSync(fullPath);
      const daysSinceModified =
        (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
      // If modified recently but L0 looks old (very short for content size)
      if (daysSinceModified < 7 && bodyLines.length > 20 && l0Words < 8) {
        report.staleL0s.push({
          page: pagePath,
          reason: `Recently modified with brief L0 (${l0Words} words)`,
        });
      }
    } catch {
      // Can't stat — skip
    }
  }
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function getReportPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(WIKI_DIR, `housekeeping-${date}.log`);
}

function formatReport(
  report: HousekeepingReport,
  dryRun: boolean
): string {
  const ts = new Date(report.timestamp).toISOString().replace("T", " ").slice(0, 19);
  const lines: string[] = [
    `# Housekeeping Report — ${ts}${dryRun ? " (DRY RUN)" : ""}`,
    "",
  ];

  // Hot Memory
  lines.push("## Hot Memory Pruning");
  if (report.hotMemory.itemsMoved.length > 0) {
    lines.push(`Moved ${report.hotMemory.itemsMoved.length} items:`);
    for (const item of report.hotMemory.itemsMoved) {
      lines.push(`- ${item.item} → ${item.destination} (${item.reason})`);
    }
  } else {
    lines.push("No items to move.");
  }
  lines.push(`Kept: ${report.hotMemory.itemsKept} items`);
  lines.push(`Final size: ${report.hotMemory.finalLineCount} lines`);
  lines.push("");

  // Observations
  lines.push("## Observation Archival");
  if (report.observations.archived > 0) {
    lines.push(
      `Archived ${report.observations.archived} entries → ${report.observations.archivePath}`
    );
  } else {
    lines.push("No observations to archive.");
  }
  lines.push("");

  // Links
  lines.push("## Wiki Link Audit");
  if (report.links.fixed.length > 0) {
    lines.push(`Fixed ${report.links.fixed.length} links:`);
    for (const fix of report.links.fixed) {
      lines.push(`- ${fix.page}: [[${fix.from}]] → [[${fix.to}]]`);
    }
  }
  if (report.links.broken.length > 0) {
    lines.push(`Broken links: ${report.links.broken.length}`);
    for (const broken of report.links.broken) {
      lines.push(`- ${broken.page}: [[${broken.link}]]`);
    }
  }
  if (report.links.fixed.length === 0 && report.links.broken.length === 0) {
    lines.push("All links valid.");
  }
  lines.push("");

  // Stale L0s
  lines.push("## Stale L0 Detection");
  if (report.staleL0s.length > 0) {
    lines.push(`Pages needing L0 refresh: ${report.staleL0s.length}`);
    for (const l0 of report.staleL0s) {
      lines.push(`- ${l0.page} (${l0.reason})`);
    }
  } else {
    lines.push("All L0 summaries look current.");
  }
  lines.push("");

  // Index
  lines.push("## Index Rebuild");
  if (report.indexRebuilt) {
    lines.push(`✓ Regenerated with ${report.indexPageCount} pages`);
  } else if (dryRun) {
    lines.push(`Would rebuild index (${report.indexPageCount} pages on disk)`);
  } else {
    lines.push("Index rebuild skipped.");
  }
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push(
    `- Execution time: ${(report.executionTimeMs / 1000).toFixed(1)}s`
  );
  lines.push(`- Hot memory size: ${report.hotMemory.finalLineCount} lines (target: <50)`);
  lines.push(`- Total wiki pages: ${report.indexPageCount}`);
  lines.push(`- Broken links: ${report.links.broken.length}`);
  if (report.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");
    for (const err of report.errors) {
      lines.push(`- ❌ ${err}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function summarizeReport(report: HousekeepingReport): string {
  const parts: string[] = [];
  if (report.hotMemory.itemsMoved.length > 0) {
    parts.push(`hot-memory: ${report.hotMemory.itemsMoved.length} moved`);
  }
  if (report.links.fixed.length > 0) {
    parts.push(`links: ${report.links.fixed.length} fixed`);
  }
  if (report.links.broken.length > 0) {
    parts.push(`broken: ${report.links.broken.length}`);
  }
  if (report.staleL0s.length > 0) {
    parts.push(`stale L0s: ${report.staleL0s.length}`);
  }
  parts.push(`index: ${report.indexPageCount} pages`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Telegram notification (lightweight — no grammy dependency)
// ---------------------------------------------------------------------------

async function sendNotification(report: HousekeepingReport): Promise<void> {
  const enabled = process.env.HOUSEKEEPING_NOTIFY_TELEGRAM;
  if (enabled !== "true") return;

  const errorOnly = process.env.HOUSEKEEPING_NOTIFY_ON_ERROR_ONLY === "true";
  if (errorOnly && report.errors.length === 0) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const userId = process.env.AUTHORIZED_USER_ID;
  if (!token || !userId) return;

  const date = new Date(report.timestamp)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);

  const lines: string[] = [`🧹 Nightly Housekeeping (${date})`, ""];

  // Hot memory
  if (report.hotMemory.itemsMoved.length > 0) {
    lines.push(
      `✓ Hot memory: ${report.hotMemory.itemsMoved.length} items moved`
    );
  } else {
    lines.push("✓ Hot memory: clean");
  }

  // Links
  const linkParts: string[] = [];
  if (report.links.fixed.length > 0)
    linkParts.push(`${report.links.fixed.length} fixed`);
  if (report.links.broken.length > 0)
    linkParts.push(`${report.links.broken.length} broken`);
  if (linkParts.length > 0) {
    const icon = report.links.broken.length > 0 ? "⚠" : "✓";
    lines.push(`${icon} Links: ${linkParts.join(", ")}`);
  } else {
    lines.push("✓ Links: all valid");
  }

  // L0s
  if (report.staleL0s.length > 0) {
    lines.push(`⚠ L0s: ${report.staleL0s.length} pages need refresh`);
  } else {
    lines.push("✓ L0s: all current");
  }

  // Index
  if (report.indexRebuilt) {
    lines.push(`✓ Index rebuilt (${report.indexPageCount} pages)`);
  }

  // Errors
  if (report.errors.length > 0) {
    lines.push("");
    for (const err of report.errors) {
      lines.push(`❌ ${err}`);
    }
  }

  lines.push("");
  lines.push(
    `Full report: ~/.max/wiki/housekeeping-${new Date(report.timestamp).toISOString().slice(0, 10)}.log`
  );

  const text = lines.join("\n");

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: parseInt(userId, 10),
          text,
        }),
      }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  } catch (err) {
    console.error(
      `[housekeeping] Telegram notification failed: ${errorMessage(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Console output for CLI
// ---------------------------------------------------------------------------

export function printReportSummary(report: HousekeepingReport, dryRun: boolean): void {
  const prefix = dryRun ? "[DRY RUN] " : "";
  console.log(`\n${prefix}🧹 Housekeeping Report`);
  console.log("─".repeat(40));

  // Hot memory
  if (report.hotMemory.itemsMoved.length > 0) {
    console.log(
      `  Hot memory: ${report.hotMemory.itemsMoved.length} items moved, ${report.hotMemory.itemsKept} kept`
    );
    for (const item of report.hotMemory.itemsMoved.slice(0, 5)) {
      console.log(`    → ${item.item.slice(0, 60)} → ${item.destination}`);
    }
    if (report.hotMemory.itemsMoved.length > 5) {
      console.log(
        `    ... and ${report.hotMemory.itemsMoved.length - 5} more`
      );
    }
  } else {
    console.log("  Hot memory: clean");
  }

  // Observations
  if (report.observations.archived > 0) {
    console.log(
      `  Observations: ${report.observations.archived} archived → ${report.observations.archivePath}`
    );
  }

  // Links
  console.log(
    `  Links: ${report.links.fixed.length} fixed, ${report.links.broken.length} broken`
  );

  // L0s
  if (report.staleL0s.length > 0) {
    console.log(`  Stale L0s: ${report.staleL0s.length} pages need refresh`);
  } else {
    console.log("  L0s: all current");
  }

  // Index
  console.log(`  Index: ${report.indexPageCount} pages`);

  // Errors
  if (report.errors.length > 0) {
    console.log("");
    for (const err of report.errors) {
      console.error(`  ❌ ${err}`);
    }
  }

  console.log(
    `\n  Done in ${(report.executionTimeMs / 1000).toFixed(1)}s`
  );

  if (!dryRun) {
    console.log(
      `  Report saved: ${getReportPath()}`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
