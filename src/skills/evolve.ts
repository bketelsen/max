// ---------------------------------------------------------------------------
// `max evolve` CLI entry + systemd timer target.
// Thin wrapper that POSTs /cog/trigger on the running daemon. The actual
// memory-architecture audit happens in the orchestrator session via the
// cog-evolve skill. Daemon must be running.
// ---------------------------------------------------------------------------

import { triggerCogSkillViaApi, type CliTriggerResponse } from "../cog/cli-client.js";

export type EvolveReport = CliTriggerResponse;

export async function runEvolve(dryRun: boolean): Promise<EvolveReport> {
  if (dryRun) {
    console.warn("⚠ --dry-run is not supported by the COG backend. The cog-evolve skill decides what to change; running for real.");
  }
  return triggerCogSkillViaApi("evolve", true);
}

export function printReportSummary(report: EvolveReport, _dryRun: boolean): void {
  if (report.ok) {
    console.log("✓ cog-evolve dispatched to the orchestrator.");
    console.log("  The skill runs in the background; tail daemon logs for progress.");
    if (report.details && Object.keys(report.details).length > 0) {
      console.log(JSON.stringify(report.details, null, 2));
    }
    return;
  }
  if (report.error) {
    console.error(`✗ ${report.error}`);
  } else if (report.reason) {
    console.error(`✗ evolve refused: ${report.reason}`);
  } else {
    console.error(`✗ evolve failed (HTTP ${report.httpStatus})`);
  }
  process.exitCode = 1;
}
