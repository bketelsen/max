// ---------------------------------------------------------------------------
// Evolve — systems-level self-improvement audit
//
// Reviews memory architecture, evaluates process effectiveness, and proposes
// structural improvements. Runs daily at 4 AM (after housekeeping, before reflect).
//
// Key principle: Evolve changes RULES, not CONTENT.
//   - Content issues → routed to housekeeping or reflect
//   - Rule issues → proposed or applied directly
// ---------------------------------------------------------------------------

import { existsSync, statSync, mkdirSync, readdirSync, readFileSync, openSync, writeFileSync as writeFsSync, closeSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { config as loadEnv } from "dotenv";
import { WIKI_DIR, WIKI_PAGES_DIR, DB_PATH, MAX_HOME, ENV_PATH } from "../paths.js";
import {
  readPage,
  writePage,
  listPages,
  readHotMemory,
  pageExists,
  writeFileAtomic,
  readIndexFile,
  ensureWikiStructure,
} from "../wiki/fs.js";
import {
  rebuildIndexFromPages,
  extractL0,
  parseIndex,
} from "../wiki/index-manager.js";
import { appendLog } from "../wiki/log-manager.js";

// Load env vars
loadEnv({ path: ENV_PATH });
loadEnv();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchitectureReview {
  tierDesign: "good" | "needs-attention" | "poor";
  pipelineHealth: "healthy" | "degraded" | "broken";
  fileOrganization: string[];
  skillBoundaries: string[];
}

export interface AuditResult {
  status: "good" | "needs-tuning" | "broken";
  findings: string[];
  suggestedChanges: string[];
}

export interface Scorecard {
  hotMemoryLines: number;
  hotMemoryCap: number;
  hotMemoryLastModified: string;
  totalWikiPages: number;
  averageL0Length: number;
  pagesWithoutL0: number;
  brokenLinks: number;
  observationCount: number;
  recentObservationCount: number;
  archivedObservationCount: number;
  entityPages: Record<string, number>;
  sessionCount: number;
  recentSessionCount: number;
  totalTurns: number;
  housekeepingLastRun: string;
  reflectLastRun: string;
}

export interface RuleProposal {
  type: "low-risk" | "high-risk";
  description: string;
  rationale: string;
  evidence: string[];
  appliedDirectly: boolean;
}

export interface ProcessAudit {
  housekeepingEffectiveness: AuditResult;
  reflectEffectiveness: AuditResult;
  scorecard: Scorecard;
}

export interface EvolveReport {
  timestamp: string;
  runNumber: number;
  architectureReview: ArchitectureReview;
  processAudit: ProcessAudit;
  ruleProposals: RuleProposal[];
  routedIssues: string[];
  nextPriorities: string[];
  executionTimeMs: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getEvolveConfig() {
  return {
    enabled: process.env.EVOLVE_ENABLED !== "false",
    notifyTelegram: process.env.EVOLVE_NOTIFY_TELEGRAM === "true",
    notifyOnErrorOnly: process.env.EVOLVE_NOTIFY_ON_ERROR_ONLY === "true",
    hotMemoryCap: parseInt(process.env.EVOLVE_HOT_MEMORY_CAP || "50", 10),
    observationArchiveThreshold: parseInt(
      process.env.EVOLVE_OBSERVATION_ARCHIVE_THRESHOLD || "500",
      10
    ),
  };
}

// ---------------------------------------------------------------------------
// Lockfile (same pattern as housekeeping)
// ---------------------------------------------------------------------------

const LOCKFILE_PATH = join(MAX_HOME, "evolve.lock");

function acquireLock(): () => void {
  mkdirSync(dirname(LOCKFILE_PATH), { recursive: true });
  if (existsSync(LOCKFILE_PATH)) {
    try {
      const stat = statSync(LOCKFILE_PATH);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 600_000) {
        throw new Error(
          "Another evolve process is running (lockfile exists and is recent). " +
            "If this is stale, delete: " +
            LOCKFILE_PATH
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Another evolve"))
        throw err;
    }
  }

  const fd = openSync(LOCKFILE_PATH, "w");
  writeFsSync(fd, `pid=${process.pid}\ntime=${new Date().toISOString()}\n`);
  closeSync(fd);

  return () => {
    try {
      unlinkSync(LOCKFILE_PATH);
    } catch {
      /* best-effort */
    }
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runEvolve(dryRun = false): Promise<EvolveReport> {
  const start = Date.now();
  const cfg = getEvolveConfig();

  ensureWikiStructure();

  let releaseLock: (() => void) | undefined;
  if (!dryRun) {
    releaseLock = acquireLock();
  }

  const report: EvolveReport = {
    timestamp: new Date().toISOString(),
    runNumber: getNextRunNumber(),
    architectureReview: {
      tierDesign: "good",
      pipelineHealth: "healthy",
      fileOrganization: [],
      skillBoundaries: [],
    },
    processAudit: {
      housekeepingEffectiveness: {
        status: "good",
        findings: [],
        suggestedChanges: [],
      },
      reflectEffectiveness: {
        status: "good",
        findings: [],
        suggestedChanges: [],
      },
      scorecard: emptyScorecard(cfg.hotMemoryCap),
    },
    ruleProposals: [],
    routedIssues: [],
    nextPriorities: [],
    executionTimeMs: 0,
    errors: [],
  };

  try {
    // 1. Architecture review
    try {
      reviewArchitecture(report, cfg);
    } catch (err) {
      report.errors.push(`Architecture review failed: ${errorMessage(err)}`);
    }

    // 2. Process audit
    try {
      await auditProcesses(report, cfg);
    } catch (err) {
      report.errors.push(`Process audit failed: ${errorMessage(err)}`);
    }

    // 3. Generate rule proposals
    try {
      generateRuleProposals(report, cfg);
    } catch (err) {
      report.errors.push(
        `Rule proposal generation failed: ${errorMessage(err)}`
      );
    }

    // 4. Route content issues
    try {
      routeContentIssues(report, cfg);
    } catch (err) {
      report.errors.push(`Content routing failed: ${errorMessage(err)}`);
    }

    // 5. Determine next priorities
    determineNextPriorities(report);

    report.executionTimeMs = Date.now() - start;

    if (!dryRun) {
      // 6. Save scorecard
      try {
        saveScorecard(report);
      } catch (err) {
        report.errors.push(`Scorecard save failed: ${errorMessage(err)}`);
      }

      // 7. Update observations
      try {
        appendEvolveObservations(report);
      } catch (err) {
        report.errors.push(
          `Observation update failed: ${errorMessage(err)}`
        );
      }

      // 8. Update log
      try {
        appendEvolveLog(report);
      } catch (err) {
        report.errors.push(`Log update failed: ${errorMessage(err)}`);
      }

      // 9. Wiki log entry
      appendLog(
        "reorg",
        `Evolve run #${report.runNumber}: ${summarizeReport(report)}`
      );

      // 10. Telegram notification
      try {
        await sendNotification(report);
      } catch (err) {
        report.errors.push(
          `Telegram notification failed: ${errorMessage(err)}`
        );
      }
    }
  } finally {
    releaseLock?.();
  }

  return report;
}

// ---------------------------------------------------------------------------
// 1. Architecture Review
// ---------------------------------------------------------------------------

function reviewArchitecture(
  report: EvolveReport,
  cfg: ReturnType<typeof getEvolveConfig>
): void {
  const arch = report.architectureReview;

  // Check tier design: hot-memory → wiki pages → session store
  const hotMemory = readHotMemory();
  const pages = listPages();
  const hasHotMemory = !!hotMemory;
  const hasPages = pages.length > 0;

  if (!hasHotMemory && !hasPages) {
    arch.tierDesign = "poor";
    arch.fileOrganization.push("No hot-memory.md and no wiki pages found");
  } else if (!hasHotMemory) {
    arch.tierDesign = "needs-attention";
    arch.fileOrganization.push("No hot-memory.md — tier 1 missing");
  }

  // Check file organization
  const expectedDirs = ["people", "projects", "facts", "preferences", "routines", "decisions"];
  for (const dir of expectedDirs) {
    const dirPath = join(WIKI_PAGES_DIR, dir);
    if (!existsSync(dirPath)) {
      // Not an error, but note if pages reference it
      const refs = pages.filter((p) => p.startsWith(`pages/${dir}/`));
      if (refs.length === 0) continue; // No pages in this category yet
    }
  }

  // Check for orphaned files (pages not in index)
  const index = parseIndex();
  const indexPaths = new Set(index.map((e) => e.path));
  for (const page of pages) {
    if (!indexPaths.has(page)) {
      arch.fileOrganization.push(`Orphaned page (not in index): ${page}`);
    }
  }

  // Check index entries pointing to missing pages
  for (const entry of index) {
    if (!pageExists(entry.path)) {
      arch.fileOrganization.push(
        `Index entry points to missing page: ${entry.path}`
      );
    }
  }

  // Check condensation pipeline (reflect → hot-memory)
  const obsPage = readPage("pages/observations.md");
  const hasObservations = !!obsPage;
  if (!hasObservations && hasPages) {
    // No observations page yet — pipeline may not be running
    arch.pipelineHealth = "degraded";
    arch.skillBoundaries.push(
      "No observations.md found — reflect pipeline may not be active"
    );
  }

  // Check skill boundaries
  const evolveLog = readPage("pages/evolve-log.md") ?? readWikiFile("evolve-log.md");
  const housekeepingLog = findLatestHousekeepingLog();

  if (!housekeepingLog) {
    arch.pipelineHealth = "degraded";
    arch.skillBoundaries.push("No housekeeping log found — housekeeping may not have run");
  }

  // Assess overall
  if (arch.fileOrganization.length > 5) {
    arch.tierDesign = "needs-attention";
  }
  if (arch.skillBoundaries.length > 2) {
    arch.pipelineHealth = "degraded";
  }
}

// ---------------------------------------------------------------------------
// 2. Process Effectiveness Audit
// ---------------------------------------------------------------------------

async function auditProcesses(
  report: EvolveReport,
  cfg: ReturnType<typeof getEvolveConfig>
): Promise<void> {
  const audit = report.processAudit;

  // Build scorecard first (used by both audits)
  await buildScorecard(audit.scorecard, cfg);

  // Audit housekeeping
  auditHousekeeping(audit, cfg);

  // Audit reflect
  auditReflect(audit, cfg);
}

async function buildScorecard(
  sc: Scorecard,
  cfg: ReturnType<typeof getEvolveConfig>
): Promise<void> {
  // Hot memory metrics
  const hotMemory = readHotMemory();
  if (hotMemory) {
    const lines = hotMemory.split("\n");
    sc.hotMemoryLines = lines.length;
    try {
      const hmPath = join(WIKI_DIR, "hot-memory.md");
      const stat = statSync(hmPath);
      sc.hotMemoryLastModified = new Date(stat.mtimeMs)
        .toISOString()
        .slice(0, 10);
    } catch {
      sc.hotMemoryLastModified = "unknown";
    }
  }
  sc.hotMemoryCap = cfg.hotMemoryCap;

  // Wiki page metrics
  const pages = listPages();
  sc.totalWikiPages = pages.length;

  // L0 metrics
  let l0Total = 0;
  let l0Count = 0;
  let pagesWithoutL0 = 0;
  const entityCounts: Record<string, number> = {};

  for (const pagePath of pages) {
    const content = readPage(pagePath);
    if (!content) continue;

    const l0 = extractL0(content);
    if (l0) {
      l0Total += l0.length;
      l0Count++;
    } else {
      pagesWithoutL0++;
    }

    // Classify entity pages
    const parts = pagePath.split("/");
    if (parts.length >= 3 && parts[0] === "pages") {
      const category = parts[1];
      entityCounts[category] = (entityCounts[category] || 0) + 1;
    }
  }

  sc.averageL0Length = l0Count > 0 ? Math.round(l0Total / l0Count) : 0;
  sc.pagesWithoutL0 = pagesWithoutL0;
  sc.entityPages = entityCounts;

  // Broken links from index
  const index = parseIndex();
  let brokenLinks = 0;
  for (const entry of index) {
    if (!pageExists(entry.path)) brokenLinks++;
  }
  sc.brokenLinks = brokenLinks;

  // Observation metrics
  const obsContent = readPage("pages/observations.md");
  if (obsContent) {
    const obsLines = obsContent.split("\n").filter((l) => l.trim().startsWith("- "));
    sc.observationCount = obsLines.length;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    sc.recentObservationCount = obsLines.filter((line) => {
      const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      return dateMatch && dateMatch[1] >= thirtyDaysAgo;
    }).length;
  }

  // Count archived observations
  const archiveDir = join(WIKI_PAGES_DIR, "archive");
  if (existsSync(archiveDir)) {
    let archivedCount = 0;
    try {
      const archiveFiles = readdirSync(archiveDir).filter((f) =>
        f.startsWith("observations-")
      );
      for (const af of archiveFiles) {
        const archContent = readPage(`pages/archive/${af}`);
        if (archContent) {
          archivedCount += archContent
            .split("\n")
            .filter((l) => l.trim().startsWith("- ")).length;
        }
      }
    } catch {
      /* ignore */
    }
    sc.archivedObservationCount = archivedCount;
  }

  // Session store metrics (from SQLite)
  try {
    const Database = (await import("better-sqlite3")).default;
    if (existsSync(DB_PATH)) {
      const db = new Database(DB_PATH, { readonly: true });
      try {
        const totalSessions =
          (
            db
              .prepare("SELECT COUNT(*) as c FROM conversation_log WHERE role = 'user'")
              .get() as { c: number }
          )?.c ?? 0;
        sc.sessionCount = totalSessions;

        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const recentSessions =
          (
            db
              .prepare(
                "SELECT COUNT(*) as c FROM conversation_log WHERE role = 'user' AND ts > ?"
              )
              .get(sevenDaysAgo) as { c: number }
          )?.c ?? 0;
        sc.recentSessionCount = recentSessions;

        const totalTurns =
          (
            db
              .prepare("SELECT COUNT(*) as c FROM conversation_log")
              .get() as { c: number }
          )?.c ?? 0;
        sc.totalTurns = totalTurns;
      } finally {
        db.close();
      }
    }
  } catch {
    // DB not available
  }

  // Pipeline health — find last run times
  sc.housekeepingLastRun = findLastRunTime("housekeeping");
  sc.reflectLastRun = findLastRunTime("reflect");
}

function auditHousekeeping(
  audit: ProcessAudit,
  cfg: ReturnType<typeof getEvolveConfig>
): void {
  const hk = audit.housekeepingEffectiveness;
  const sc = audit.scorecard;

  // Check if housekeeping ran recently
  if (sc.housekeepingLastRun === "never") {
    hk.status = "broken";
    hk.findings.push("Housekeeping has never run");
    hk.suggestedChanges.push("Install housekeeping timer: max service install-housekeeping");
    return;
  }

  // Check hot-memory line cap
  if (sc.hotMemoryLines > sc.hotMemoryCap) {
    hk.status = "needs-tuning";
    hk.findings.push(
      `Hot memory at ${sc.hotMemoryLines} lines, over ${sc.hotMemoryCap}-line cap`
    );
    hk.suggestedChanges.push("Housekeeping pruning may need adjustment");
  } else if (sc.hotMemoryLines > sc.hotMemoryCap * 0.9) {
    hk.findings.push(
      `Hot memory at ${sc.hotMemoryLines}/${sc.hotMemoryCap} (${Math.round(
        (sc.hotMemoryLines / sc.hotMemoryCap) * 100
      )}% — approaching cap)`
    );
  }

  // Check broken links
  if (sc.brokenLinks > 0) {
    hk.status = "needs-tuning";
    hk.findings.push(`${sc.brokenLinks} broken links in index`);
    hk.suggestedChanges.push("Link audit may need expanding");
  }

  // Check observation archival
  if (
    sc.observationCount > cfg.observationArchiveThreshold &&
    sc.archivedObservationCount === 0
  ) {
    hk.findings.push(
      `Observations at ${sc.observationCount} entries (threshold: ${cfg.observationArchiveThreshold}), no archival done`
    );
    hk.suggestedChanges.push("Review observation archival logic");
  }

  // Parse latest housekeeping log for details
  const hkLog = findLatestHousekeepingLog();
  if (hkLog) {
    if (hkLog.includes("❌") || hkLog.includes("error")) {
      hk.status = "needs-tuning";
      hk.findings.push("Errors found in latest housekeeping log");
    }
    if (hkLog.includes("items moved")) {
      hk.findings.push("Housekeeping successfully pruned items");
    }
  }
}

function auditReflect(
  audit: ProcessAudit,
  cfg: ReturnType<typeof getEvolveConfig>
): void {
  const reflect = audit.reflectEffectiveness;
  const sc = audit.scorecard;

  // Check if reflect has been running (observations being logged)
  if (sc.observationCount === 0) {
    reflect.status = "broken";
    reflect.findings.push("No observations found — reflect may not be running");
    reflect.suggestedChanges.push("Check reflect pipeline configuration");
    return;
  }

  // Check recent observation activity
  if (sc.recentObservationCount === 0) {
    reflect.status = "needs-tuning";
    reflect.findings.push(
      "No observations in the last 30 days — pattern detection may be too strict"
    );
    reflect.suggestedChanges.push("Lower pattern detection threshold");
  }

  // Check hot-memory freshness
  if (sc.hotMemoryLastModified !== "unknown") {
    const daysSince =
      (Date.now() - new Date(sc.hotMemoryLastModified).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSince > 14) {
      reflect.status = "needs-tuning";
      reflect.findings.push(
        `Hot memory hasn't been updated in ${Math.round(daysSince)} days`
      );
      reflect.suggestedChanges.push(
        "Review reflect → hot-memory pipeline"
      );
    }
  }

  // Check entity page synchronization
  const entityTotal = Object.values(sc.entityPages).reduce(
    (a, b) => a + b,
    0
  );
  if (entityTotal === 0 && sc.observationCount > 20) {
    reflect.findings.push(
      "Many observations but no entity pages — may need entity extraction"
    );
  }

  // Check L0 coverage
  if (sc.pagesWithoutL0 > 3) {
    reflect.findings.push(
      `${sc.pagesWithoutL0} pages missing L0 summaries`
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Rule Change Proposals
// ---------------------------------------------------------------------------

function generateRuleProposals(
  report: EvolveReport,
  cfg: ReturnType<typeof getEvolveConfig>
): void {
  const sc = report.processAudit.scorecard;
  const proposals = report.ruleProposals;

  // Low-risk: Hot memory cap adjustment
  if (sc.hotMemoryLines > 0 && sc.hotMemoryLines < cfg.hotMemoryCap * 0.3) {
    // Hot memory is very underutilized — could lower cap
    proposals.push({
      type: "low-risk",
      description: `Hot memory at ${Math.round(
        (sc.hotMemoryLines / cfg.hotMemoryCap) * 100
      )}% capacity — consider lowering cap`,
      rationale: "Significantly under-utilized hot memory suggests cap is too generous",
      evidence: [`${sc.hotMemoryLines}/${cfg.hotMemoryCap} lines used`],
      appliedDirectly: false,
    });
  }

  if (sc.hotMemoryLines > cfg.hotMemoryCap) {
    // Over cap — housekeeping needs help
    proposals.push({
      type: "low-risk",
      description: `Hot memory over cap (${sc.hotMemoryLines}/${cfg.hotMemoryCap}) — trigger immediate prune`,
      rationale: "Hot memory should stay under cap for effective context injection",
      evidence: [`${sc.hotMemoryLines} lines, cap is ${cfg.hotMemoryCap}`],
      appliedDirectly: false,
    });
  }

  // Low-risk: L0 coverage
  if (sc.pagesWithoutL0 > sc.totalWikiPages * 0.2) {
    proposals.push({
      type: "low-risk",
      description: `${sc.pagesWithoutL0}/${sc.totalWikiPages} pages missing L0 — improve L0 generation`,
      rationale: "L0 summaries are critical for fast index scanning",
      evidence: [`${Math.round((sc.pagesWithoutL0 / Math.max(sc.totalWikiPages, 1)) * 100)}% pages lack L0`],
      appliedDirectly: false,
    });
  }

  // Low-risk: Average L0 too long
  if (sc.averageL0Length > 100) {
    proposals.push({
      type: "low-risk",
      description: `Average L0 length ${sc.averageL0Length} chars (target: <100) — tighten L0 generation`,
      rationale: "Long L0s defeat the purpose of fast scanning",
      evidence: [`Average: ${sc.averageL0Length} chars across ${sc.totalWikiPages - sc.pagesWithoutL0} pages`],
      appliedDirectly: false,
    });
  }

  // Low-risk: Observation archival threshold
  if (sc.observationCount > cfg.observationArchiveThreshold * 1.5) {
    proposals.push({
      type: "low-risk",
      description: `Observations at ${sc.observationCount} — well past ${cfg.observationArchiveThreshold} threshold`,
      rationale: "Large observation files slow down scanning",
      evidence: [`${sc.observationCount} entries, threshold is ${cfg.observationArchiveThreshold}`],
      appliedDirectly: false,
    });
  }

  // High-risk: Architecture issues
  if (report.architectureReview.tierDesign === "poor") {
    proposals.push({
      type: "high-risk",
      description: "Memory tier architecture is missing or severely degraded",
      rationale: "Core memory tiers (hot-memory, wiki pages, session store) must all be present",
      evidence: report.architectureReview.fileOrganization.slice(0, 3),
      appliedDirectly: false,
    });
  }

  // High-risk: Pipeline broken
  if (report.architectureReview.pipelineHealth === "broken") {
    proposals.push({
      type: "high-risk",
      description: "Memory pipeline is broken — requires manual intervention",
      rationale: "The condensation pipeline must be operational for memory to function",
      evidence: report.architectureReview.skillBoundaries.slice(0, 3),
      appliedDirectly: false,
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Route Content Issues
// ---------------------------------------------------------------------------

function routeContentIssues(
  report: EvolveReport,
  cfg: ReturnType<typeof getEvolveConfig>
): void {
  const sc = report.processAudit.scorecard;
  const routed = report.routedIssues;

  // Route hot-memory issues to housekeeping
  if (sc.hotMemoryLines > cfg.hotMemoryCap) {
    routed.push(
      `→ housekeeping: Hot memory at ${sc.hotMemoryLines} lines, needs pruning (cap: ${cfg.hotMemoryCap})`
    );
  }

  // Route broken links to housekeeping
  if (sc.brokenLinks > 0) {
    routed.push(
      `→ housekeeping: ${sc.brokenLinks} broken links detected, needs link audit`
    );
  }

  // Route observation growth to housekeeping
  if (sc.observationCount > cfg.observationArchiveThreshold) {
    routed.push(
      `→ housekeeping: observations.md at ${sc.observationCount} entries, needs archival (threshold: ${cfg.observationArchiveThreshold})`
    );
  }

  // Route pattern detection issues to reflect
  if (sc.recentObservationCount === 0 && sc.observationCount > 0) {
    routed.push(
      "→ reflect: No new observations in 30 days, check pattern detection threshold"
    );
  }

  // Route L0 issues to reflect
  if (sc.pagesWithoutL0 > 3) {
    routed.push(
      `→ reflect: ${sc.pagesWithoutL0} pages missing L0 summaries, need generation`
    );
  }

  // Route hot-memory staleness to reflect
  if (sc.hotMemoryLastModified !== "unknown") {
    const daysSince =
      (Date.now() - new Date(sc.hotMemoryLastModified).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSince > 14) {
      routed.push(
        `→ reflect: Hot memory hasn't been updated in ${Math.round(daysSince)} days, check pipeline`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Scorecard Generation
// ---------------------------------------------------------------------------

function saveScorecard(report: EvolveReport): void {
  const sc = report.processAudit.scorecard;
  const now = new Date(report.timestamp)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);

  const hmPercent = sc.hotMemoryCap > 0
    ? Math.round((sc.hotMemoryLines / sc.hotMemoryCap) * 100)
    : 0;
  const hmStatus = sc.hotMemoryLines <= sc.hotMemoryCap ? "✅" : "⚠️";
  const l0Status = sc.averageL0Length <= 100 ? "✅" : "⚠️";
  const linkStatus = sc.brokenLinks === 0 ? "✅" : "⚠️";
  const obsStatus =
    sc.observationCount > getEvolveConfig().observationArchiveThreshold
      ? "⚠️ Consider archival"
      : "✅";

  const entityLines = Object.entries(sc.entityPages)
    .map(([cat, count]) => `- ${capitalize(cat)}: ${count} pages`)
    .join("\n");

  const hkRunStatus = sc.housekeepingLastRun !== "never"
    ? `Last run ${sc.housekeepingLastRun} ✅`
    : "Never run ⚠️";
  const reflectRunStatus = sc.reflectLastRun !== "never"
    ? `Last run ${sc.reflectLastRun} ✅`
    : "Not yet tracked";

  const content = `<!-- L0: Memory system metrics snapshot from latest evolve run -->
# Memory System Scorecard

Last updated: ${now}

## Hot Memory
- Line count: ${sc.hotMemoryLines} / ${sc.hotMemoryCap} (${hmPercent}% capacity) ${hmStatus}
- Last updated: ${sc.hotMemoryLastModified}

## Wiki Pages
- Total pages: ${sc.totalWikiPages}
- Average L0 length: ${sc.averageL0Length} chars (target: <100) ${l0Status}
- Pages without L0: ${sc.pagesWithoutL0}
- Pages with broken links: ${sc.brokenLinks} ${linkStatus}

## Observations
- Total entries: ${sc.observationCount}
- Last 30 days: ${sc.recentObservationCount}
- Archived entries: ${sc.archivedObservationCount}

## Entity Pages
${entityLines || "- (none yet)"}

## Session Store
- Total messages: ${sc.sessionCount}
- Last 7 days: ${sc.recentSessionCount}
- Total turns: ${sc.totalTurns}

## Pipeline Health
- Housekeeping: ${hkRunStatus}
- Reflect: ${reflectRunStatus}
- Evolve: This run (${now})

## Targets
- Hot memory: ${hmStatus} ${sc.hotMemoryLines <= sc.hotMemoryCap ? "Under" : "Over"} ${sc.hotMemoryCap} lines
- L0 summaries: ${l0Status} ${sc.averageL0Length <= 100 ? "Under" : "Over"} 100 chars average
- Broken links: ${linkStatus} ${sc.brokenLinks === 0 ? "Zero" : sc.brokenLinks + " found"}
- Observation log: ${obsStatus} (${sc.observationCount} entries, threshold: ${getEvolveConfig().observationArchiveThreshold})
`;

  const scorecardPath = join(WIKI_DIR, "evolve-scorecard.md");
  writeFileAtomic(scorecardPath, content);
}

// ---------------------------------------------------------------------------
// 6. Observations & Log Management
// ---------------------------------------------------------------------------

function appendEvolveObservations(report: EvolveReport): void {
  const obsPath = join(WIKI_DIR, "evolve-observations.md");
  const date = new Date(report.timestamp).toISOString().slice(0, 10);
  const newEntries: string[] = [];

  // Tag findings from architecture review
  for (const issue of report.architectureReview.fileOrganization) {
    newEntries.push(`- ${date} [architecture]: ${issue}`);
  }
  for (const issue of report.architectureReview.skillBoundaries) {
    newEntries.push(`- ${date} [architecture]: ${issue}`);
  }

  // Tag findings from process audit
  const hk = report.processAudit.housekeepingEffectiveness;
  for (const finding of hk.findings) {
    newEntries.push(`- ${date} [process-health]: Housekeeping: ${finding}`);
  }
  const reflect = report.processAudit.reflectEffectiveness;
  for (const finding of reflect.findings) {
    newEntries.push(`- ${date} [process-health]: Reflect: ${finding}`);
  }

  // Tag rule proposals
  for (const proposal of report.ruleProposals) {
    const tag = proposal.type === "high-risk" ? "architecture" : "rule-drift";
    newEntries.push(`- ${date} [${tag}]: ${proposal.description}`);
  }

  if (newEntries.length === 0) {
    newEntries.push(`- ${date} [process-health]: All systems nominal`);
  }

  if (!existsSync(obsPath)) {
    const content = `<!-- L0: Architectural issues spotted by evolve runs -->
# Evolve Observations

${newEntries.join("\n")}
`;
    writeFileAtomic(obsPath, content);
  } else {
    const existing = readFileSync(obsPath, "utf-8");
    const updated = existing.trimEnd() + "\n" + newEntries.join("\n") + "\n";
    writeFileAtomic(obsPath, updated);
  }
}

function appendEvolveLog(report: EvolveReport): void {
  const logPath = join(WIKI_DIR, "evolve-log.md");
  const date = new Date(report.timestamp).toISOString().slice(0, 10);
  const time = new Date(report.timestamp)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);
  const sc = report.processAudit.scorecard;
  const hmPercent = sc.hotMemoryCap > 0
    ? Math.round((sc.hotMemoryLines / sc.hotMemoryCap) * 100)
    : 0;

  const hkStatus =
    report.processAudit.housekeepingEffectiveness.status === "good"
      ? "✅"
      : report.processAudit.housekeepingEffectiveness.status === "needs-tuning"
        ? "⚠️"
        : "❌";
  const reflectStatus =
    report.processAudit.reflectEffectiveness.status === "good"
      ? "✅"
      : report.processAudit.reflectEffectiveness.status === "needs-tuning"
        ? "⚠️"
        : "❌";

  const appliedProposals = report.ruleProposals.filter((p) => p.appliedDirectly);
  const proposedProposals = report.ruleProposals.filter((p) => !p.appliedDirectly);

  const entry = `
## Run #${report.runNumber} — ${time}

### Process Health
- Housekeeping: ${hkStatus} ${report.processAudit.housekeepingEffectiveness.status}
- Reflect: ${reflectStatus} ${report.processAudit.reflectEffectiveness.status}

### Scorecard
- Hot memory: ${sc.hotMemoryLines}/${sc.hotMemoryCap} lines (${hmPercent}%) ${sc.hotMemoryLines <= sc.hotMemoryCap ? "✅" : "⚠️"}
- Wiki pages: ${sc.totalWikiPages} total
- Observations: ${sc.observationCount} total, ${sc.recentObservationCount} recent
- Broken links: ${sc.brokenLinks} ${sc.brokenLinks === 0 ? "✅" : "⚠️"}

### Rule Changes Applied
${appliedProposals.length > 0 ? appliedProposals.map((p) => `- ${p.description}`).join("\n") : "- None this run"}

### Rule Changes Proposed
${proposedProposals.length > 0 ? proposedProposals.map((p) => `- ${p.description}`).join("\n") : "- None this run"}

### Routed Issues
${report.routedIssues.length > 0 ? report.routedIssues.map((i) => `- ${i}`).join("\n") : "- None this run"}

### Architecture Notes
${report.architectureReview.fileOrganization.length > 0 || report.architectureReview.skillBoundaries.length > 0
    ? [...report.architectureReview.fileOrganization, ...report.architectureReview.skillBoundaries]
        .map((n) => `- ${n}`)
        .join("\n")
    : "- Architecture looks healthy"}

### Next Priorities
${report.nextPriorities.map((p, i) => `${i + 1}. ${p}`).join("\n")}

---
`;

  if (!existsSync(logPath)) {
    const content = `<!-- L0: Evolve run history with rule changes and priorities -->
# Evolve Log

## Next Run Priorities
${report.nextPriorities.map((p, i) => `${i + 1}. ${p}`).join("\n")}

---
${entry}`;
    writeFileAtomic(logPath, content);
  } else {
    const existing = readFileSync(logPath, "utf-8");

    // Update the "Next Run Priorities" section at the top
    const prioritySection = `## Next Run Priorities\n${report.nextPriorities.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
    let updated = existing.replace(
      /## Next Run Priorities[\s\S]*?(?=\n---)/,
      prioritySection + "\n"
    );

    // Insert the new entry after the first ---
    const firstDivider = updated.indexOf("\n---\n");
    if (firstDivider >= 0) {
      updated =
        updated.slice(0, firstDivider + 5) +
        entry +
        updated.slice(firstDivider + 5);
    } else {
      // No divider found, append
      updated = updated.trimEnd() + "\n\n---\n" + entry;
    }

    writeFileAtomic(logPath, updated);
  }
}

// ---------------------------------------------------------------------------
// 7. Debrief (Telegram notification)
// ---------------------------------------------------------------------------

async function sendNotification(report: EvolveReport): Promise<void> {
  const cfg = getEvolveConfig();
  if (!cfg.notifyTelegram) return;
  if (cfg.notifyOnErrorOnly && report.errors.length === 0) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const userId = process.env.AUTHORIZED_USER_ID;
  if (!token || !userId) return;

  const date = new Date(report.timestamp)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);
  const sc = report.processAudit.scorecard;
  const hmPercent = sc.hotMemoryCap > 0
    ? Math.round((sc.hotMemoryLines / sc.hotMemoryCap) * 100)
    : 0;

  const hkIcon =
    report.processAudit.housekeepingEffectiveness.status === "good"
      ? "✅"
      : "⚠️";
  const reflectIcon =
    report.processAudit.reflectEffectiveness.status === "good"
      ? "✅"
      : "⚠️";

  const applied = report.ruleProposals.filter((p) => p.appliedDirectly).length;
  const proposed = report.ruleProposals.filter((p) => !p.appliedDirectly).length;

  const lines: string[] = [
    `🔧 Architecture Audit (${date})`,
    "",
    "📊 Scorecard:",
    `  • Hot memory: ${sc.hotMemoryLines}/${sc.hotMemoryCap} lines (${hmPercent}%) ${sc.hotMemoryLines <= sc.hotMemoryCap ? "✅" : "⚠️"}`,
    `  • Wiki pages: ${sc.totalWikiPages}`,
    `  • Broken links: ${sc.brokenLinks} ${sc.brokenLinks === 0 ? "✅" : "⚠️"}`,
    "",
    "🔍 Process Health:",
    `  • Housekeeping: ${hkIcon} ${report.processAudit.housekeepingEffectiveness.status}`,
    `  • Reflect: ${reflectIcon} ${report.processAudit.reflectEffectiveness.status}`,
  ];

  if (report.ruleProposals.length > 0 || report.routedIssues.length > 0) {
    lines.push("", "📝 Actions:");
    if (applied > 0) lines.push(`  • ${applied} rule changes applied`);
    if (proposed > 0) lines.push(`  • ${proposed} rule changes proposed`);
    if (report.routedIssues.length > 0)
      lines.push(`  • ${report.routedIssues.length} issues routed`);
  }

  if (report.errors.length > 0) {
    lines.push("");
    for (const err of report.errors) {
      lines.push(`❌ ${err}`);
    }
  }

  lines.push(
    "",
    `Full report: ~/.max/wiki/evolve-log.md`
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
      `[evolve] Telegram notification failed: ${errorMessage(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Console output for CLI
// ---------------------------------------------------------------------------

export function printReportSummary(
  report: EvolveReport,
  dryRun: boolean
): void {
  const prefix = dryRun ? "[DRY RUN] " : "";
  console.log(`\n${prefix}🔧 Evolution Report`);
  console.log("─".repeat(40));

  // Architecture
  console.log(
    `  Architecture: ${report.architectureReview.tierDesign}`
  );
  console.log(
    `  Pipeline health: ${report.architectureReview.pipelineHealth}`
  );

  // Scorecard highlights
  const sc = report.processAudit.scorecard;
  console.log(
    `  Hot memory: ${sc.hotMemoryLines}/${sc.hotMemoryCap} lines`
  );
  console.log(`  Wiki pages: ${sc.totalWikiPages}`);
  console.log(`  Broken links: ${sc.brokenLinks}`);

  // Process health
  console.log(
    `  Housekeeping: ${report.processAudit.housekeepingEffectiveness.status}`
  );
  console.log(
    `  Reflect: ${report.processAudit.reflectEffectiveness.status}`
  );

  // Proposals
  const applied = report.ruleProposals.filter(
    (p) => p.appliedDirectly
  ).length;
  const proposed = report.ruleProposals.filter(
    (p) => !p.appliedDirectly
  ).length;
  console.log(`  Rule proposals: ${report.ruleProposals.length}`);
  if (applied > 0) console.log(`    Applied: ${applied}`);
  if (proposed > 0) console.log(`    Proposed: ${proposed}`);

  // Routed issues
  if (report.routedIssues.length > 0) {
    console.log(`  Routed issues: ${report.routedIssues.length}`);
    for (const issue of report.routedIssues.slice(0, 5)) {
      console.log(`    ${issue}`);
    }
  }

  // Next priorities
  if (report.nextPriorities.length > 0) {
    console.log(`  Next priorities:`);
    for (const p of report.nextPriorities) {
      console.log(`    • ${p}`);
    }
  }

  // Errors
  if (report.errors.length > 0) {
    console.log("");
    for (const err of report.errors) {
      console.log(`  ❌ ${err}`);
    }
  }

  console.log(
    `\n  Completed in ${(report.executionTimeMs / 1000).toFixed(1)}s`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyScorecard(cap: number): Scorecard {
  return {
    hotMemoryLines: 0,
    hotMemoryCap: cap,
    hotMemoryLastModified: "unknown",
    totalWikiPages: 0,
    averageL0Length: 0,
    pagesWithoutL0: 0,
    brokenLinks: 0,
    observationCount: 0,
    recentObservationCount: 0,
    archivedObservationCount: 0,
    entityPages: {},
    sessionCount: 0,
    recentSessionCount: 0,
    totalTurns: 0,
    housekeepingLastRun: "never",
    reflectLastRun: "never",
  };
}

function getNextRunNumber(): number {
  const logPath = join(WIKI_DIR, "evolve-log.md");
  if (!existsSync(logPath)) return 1;
  try {
    const content = readFileSync(logPath, "utf-8");
    const matches = content.matchAll(/## Run #(\d+)/g);
    let max = 0;
    for (const m of matches) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
    return max + 1;
  } catch {
    return 1;
  }
}

function findLastRunTime(process: string): string {
  // Check housekeeping logs
  if (process === "housekeeping") {
    const log = findLatestHousekeepingLog();
    if (log) {
      const dateMatch = log.match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2})/);
      if (dateMatch) return dateMatch[1];
    }
    return "never";
  }

  // Check reflect — look for observation timestamps
  if (process === "reflect") {
    const obs = readPage("pages/observations.md");
    if (obs) {
      const lines = obs.split("\n").filter((l) => l.trim().startsWith("- "));
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const dateMatch = lastLine.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) return dateMatch[1];
      }
    }
    return "never";
  }

  return "never";
}

function findLatestHousekeepingLog(): string | undefined {
  try {
    const files = readdirSync(WIKI_DIR).filter((f) =>
      f.startsWith("housekeeping-") && f.endsWith(".log")
    );
    if (files.length === 0) return undefined;
    files.sort().reverse();
    const latest = join(WIKI_DIR, files[0]);
    return readFileSync(latest, "utf-8");
  } catch {
    return undefined;
  }
}

function readWikiFile(name: string): string | undefined {
  const fullPath = join(WIKI_DIR, name);
  if (!existsSync(fullPath)) return undefined;
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return undefined;
  }
}

function determineNextPriorities(report: EvolveReport): void {
  const priorities: string[] = [];

  // Priority based on architecture issues
  if (report.architectureReview.tierDesign !== "good") {
    priorities.push("Fix memory tier architecture issues");
  }
  if (report.architectureReview.pipelineHealth !== "healthy") {
    priorities.push("Restore pipeline health");
  }

  // Priority based on process audit
  if (
    report.processAudit.housekeepingEffectiveness.status !== "good"
  ) {
    priorities.push("Tune housekeeping effectiveness");
  }
  if (report.processAudit.reflectEffectiveness.status !== "good") {
    priorities.push("Tune reflect pipeline");
  }

  // Priority based on scorecard
  const sc = report.processAudit.scorecard;
  if (sc.hotMemoryLines > sc.hotMemoryCap) {
    priorities.push("Reduce hot-memory to under cap");
  }
  if (sc.brokenLinks > 0) {
    priorities.push("Fix broken wiki links");
  }
  if (sc.pagesWithoutL0 > 3) {
    priorities.push("Add L0 summaries to uncovered pages");
  }

  // Default priorities if nothing urgent
  if (priorities.length === 0) {
    priorities.push("Monitor system health");
    priorities.push("Review rule effectiveness");
    priorities.push("Evaluate memory utilization");
  }

  // Keep top 3
  report.nextPriorities = priorities.slice(0, 3);
}

function summarizeReport(report: EvolveReport): string {
  const parts: string[] = [];
  parts.push(`arch=${report.architectureReview.tierDesign}`);
  parts.push(`pipeline=${report.architectureReview.pipelineHealth}`);
  if (report.ruleProposals.length > 0) {
    parts.push(`proposals=${report.ruleProposals.length}`);
  }
  if (report.routedIssues.length > 0) {
    parts.push(`routed=${report.routedIssues.length}`);
  }
  return parts.join(", ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
