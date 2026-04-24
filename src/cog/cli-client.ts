// ---------------------------------------------------------------------------
// CLI → daemon bridge for COG pipeline skills.
// Used by `max reflect`, `max housekeeping`, `max evolve` (invoked by the
// user directly or by their systemd timers). Posts to the running daemon's
// /cog/trigger endpoint so skill dispatch goes through the orchestrator queue
// like any other scheduler-driven run.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "fs";
import { API_TOKEN_PATH } from "../paths.js";

const DEFAULT_API_URL = "http://127.0.0.1:7777";

export type CliSkill = "reflect" | "housekeeping" | "foresight" | "evolve";

export interface CliTriggerResponse {
  ok: boolean;
  httpStatus: number;
  skill: CliSkill;
  reason?: string;
  details?: Record<string, unknown>;
  error?: string;
}

function getApiUrl(): string {
  return process.env.MAX_API_URL || DEFAULT_API_URL;
}

function getApiToken(): string {
  if (!existsSync(API_TOKEN_PATH)) return "";
  try {
    return readFileSync(API_TOKEN_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}

export async function triggerCogSkillViaApi(
  skill: CliSkill,
  force = true,
): Promise<CliTriggerResponse> {
  const url = `${getApiUrl()}/cog/trigger`;
  const token = getApiToken();

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ skill, force }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      httpStatus: 0,
      skill,
      error: `daemon unreachable at ${getApiUrl()} — is it running? (${msg})`,
    };
  }

  let body: any = {};
  try { body = await resp.json(); } catch { /* body not json */ }

  return {
    ok: resp.ok && !!body.ok,
    httpStatus: resp.status,
    skill,
    reason: body.reason,
    details: body.details,
    error: resp.ok ? undefined : body.error,
  };
}
