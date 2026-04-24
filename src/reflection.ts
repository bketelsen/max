// ---------------------------------------------------------------------------
// `max reflect` CLI entry + systemd timer target.
// Thin wrapper that POSTs /cog/trigger on the running daemon. The actual
// conversation mining / pattern distillation / thread detection happens in
// the orchestrator session via the cog-reflect skill. Daemon must be running.
// ---------------------------------------------------------------------------

import { triggerCogSkillViaApi } from "./cog/cli-client.js";

export async function runReflectionCli(dryRun: boolean, hours: number): Promise<void> {
  if (dryRun) {
    console.warn("⚠ --dry-run is not supported by the COG backend. The cog-reflect skill decides what to change; running for real.");
  }
  if (hours !== 24) {
    console.warn(`⚠ --hours ${hours} is ignored by the COG backend. cog-reflect processes new session-store turns since its persisted cursor.`);
  }

  const res = await triggerCogSkillViaApi("reflect", true);

  if (res.ok) {
    console.log("✓ cog-reflect dispatched to the orchestrator.");
    console.log("  The skill runs in the background; tail daemon logs for progress.");
    if (res.details && Object.keys(res.details).length > 0) {
      console.log(JSON.stringify(res.details, null, 2));
    }
    return;
  }

  if (res.error) {
    console.error(`✗ ${res.error}`);
  } else if (res.reason) {
    console.error(`✗ reflect refused: ${res.reason}`);
  } else {
    console.error(`✗ reflect failed (HTTP ${res.httpStatus})`);
  }
  process.exit(1);
}
