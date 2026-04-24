// ---------------------------------------------------------------------------
// COG scheduler — fires cog-reflect / cog-housekeeping / cog-foresight on a
// schedule by injecting background prompts into the orchestrator queue.
// All LLM work happens in the orchestrator session; this file only
// orchestrates cadence and tracks run timing.
// ---------------------------------------------------------------------------

import { existsSync } from "fs";
import { join } from "path";
import { getState, setState } from "../store/db.js";
import { sendToOrchestrator } from "../copilot/orchestrator.js";
import { COG_META_DIR } from "../paths.js";
import { acquireReflectLock, releaseReflectLock } from "./locks.js";

const TICK_INTERVAL_MS = 10 * 60 * 1000; // check every 10 min
const REFLECT_MIN_GAP_MS = 20 * 60 * 60 * 1000; // 20 h
const HOUSEKEEPING_MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 d
const FORESIGHT_MIN_GAP_MS = 20 * 60 * 60 * 1000; // 20 h
const FORESIGHT_MORNING_HOUR_MIN = 6;
const FORESIGHT_MORNING_HOUR_MAX = 11;

const KEY_LAST_REFLECT = "cog_last_reflect_at";
const KEY_LAST_HOUSEKEEPING = "cog_last_housekeeping_at";
const KEY_LAST_FORESIGHT = "cog_last_foresight_at";

let tickTimer: ReturnType<typeof setInterval> | undefined;
let running = false;

function lastRunAt(key: string): number {
  return parseInt(getState(key) || "0", 10);
}

function markRun(key: string): void {
  setState(key, String(Date.now()));
}

export function buildReflectPrompt(): string {
  return "[cog-scheduler] Run the cog-reflect skill now. Query session-store.db for new turns since your cursor, analyze conversations, update patterns and self-observations per the skill instructions. You own the cursor — advance it only on successful completion.";
}

export type CogSkillName = "reflect" | "housekeeping" | "foresight" | "evolve";

export interface TriggerResult {
  ok: boolean;
  skill: CogSkillName;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Dispatch cog-reflect. With force=false, respects the 20 h gap.
 * The reflect skill owns its own cursor and session-store querying.
 */
export function triggerReflect(force = false): TriggerResult {
  const now = Date.now();
  if (!force && now - lastRunAt(KEY_LAST_REFLECT) < REFLECT_MIN_GAP_MS) {
    return { ok: false, skill: "reflect", reason: "within 20 h cooldown; pass force=true to override" };
  }

  if (!acquireReflectLock(now)) {
    return { ok: false, skill: "reflect", reason: "Reflect already in progress" };
  }

  markRun(KEY_LAST_REFLECT);

  try {
    void sendToOrchestrator(buildReflectPrompt(), { type: "background" }, (_text, done) => {
      if (done) {
        releaseReflectLock();
      }
    });
  } catch (error) {
    releaseReflectLock();
    throw error;
  }

  console.log(`[cog-scheduler] Triggered cog-reflect${force ? " [forced]" : ""}`);

  return { ok: true, skill: "reflect", details: { forced: force } };
}

/** Dispatch cog-housekeeping. With force=false, respects the 7-day gap. */
export function triggerHousekeeping(force = false): TriggerResult {
  const now = Date.now();
  if (!force && now - lastRunAt(KEY_LAST_HOUSEKEEPING) < HOUSEKEEPING_MIN_GAP_MS) {
    return { ok: false, skill: "housekeeping", reason: "within 7-day cooldown; pass force=true to override" };
  }
  markRun(KEY_LAST_HOUSEKEEPING);

  const prompt = `[cog-scheduler] Run the cog-housekeeping skill now. Archive old entries to glacier, rebuild memory/link-index.md, and prune hot-memory.md to <50 lines per the skill instructions.`;

  sendToOrchestrator(prompt, { type: "background" }, () => {});
  console.log(`[cog-scheduler] Triggered cog-housekeeping${force ? " [forced]" : ""}`);

  return { ok: true, skill: "housekeeping", details: { forced: force } };
}

/**
 * Dispatch cog-foresight. With force=false, requires the morning window, a
 * 20 h gap, and an existing briefing-bridge.md. With force=true, only the
 * briefing-bridge.md requirement stands (foresight depends on it as input).
 */
export function triggerForesight(force = false): TriggerResult {
  const now = Date.now();
  if (!force) {
    const hour = new Date().getHours();
    if (hour < FORESIGHT_MORNING_HOUR_MIN || hour > FORESIGHT_MORNING_HOUR_MAX) {
      return { ok: false, skill: "foresight", reason: "outside morning window (06:00–11:00); pass force=true to override" };
    }
    if (now - lastRunAt(KEY_LAST_FORESIGHT) < FORESIGHT_MIN_GAP_MS) {
      return { ok: false, skill: "foresight", reason: "within 20 h cooldown; pass force=true to override" };
    }
  }
  if (!existsSync(join(COG_META_DIR, "briefing-bridge.md"))) {
    return { ok: false, skill: "foresight", reason: "memory/cog-meta/briefing-bridge.md is missing — run housekeeping first" };
  }
  markRun(KEY_LAST_FORESIGHT);

  const prompt = `[cog-scheduler] Run the cog-foresight skill now. Read memory/cog-meta/briefing-bridge.md and synthesize one strategic nudge into memory/cog-meta/foresight-nudge.md per the skill instructions.`;

  sendToOrchestrator(prompt, { type: "background" }, () => {});
  console.log(`[cog-scheduler] Triggered cog-foresight${force ? " [forced]" : ""}`);

  return { ok: true, skill: "foresight", details: { forced: force } };
}

/**
 * Dispatch cog-evolve. Always forced in practice — evolve is a manual audit
 * with no cadence. `force` is accepted for API symmetry but ignored.
 */
export function triggerEvolve(_force = true): TriggerResult {
  const prompt = `[cog-scheduler] Run the cog-evolve skill now. Audit the memory architecture under ~/.max/cog/memory/: file sizes, age, bloat, rule drift, stale L0 headers. Append findings to memory/cog-meta/improvements.md and memory/cog-meta/self-observations.md per the skill instructions.`;

  sendToOrchestrator(prompt, { type: "background" }, () => {});
  console.log("[cog-scheduler] Triggered cog-evolve");

  return { ok: true, skill: "evolve", details: {} };
}

function tick(): void {
  if (running) return;
  running = true;
  try {
    triggerReflect(false);
    triggerHousekeeping(false);
    triggerForesight(false);
  } catch (err) {
    console.error("[cog-scheduler] tick error (non-fatal):", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startCogScheduler(): void {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  tickTimer.unref();
  console.log(`[cog-scheduler] Started (tick every ${TICK_INTERVAL_MS / 60000} min)`);
}

export function stopCogScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
}
