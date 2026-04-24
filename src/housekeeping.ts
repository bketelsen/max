// ---------------------------------------------------------------------------
// `max housekeeping` CLI entry + systemd timer target.
// Thin wrapper that POSTs /cog/trigger on the running daemon. The actual
// archival/pruning/link-audit work happens in the orchestrator session via
// the cog-housekeeping skill. Daemon must be running.
// ---------------------------------------------------------------------------

import { triggerCogSkillViaApi, type CliTriggerResponse } from "./cog/cli-client.js";

export type HousekeepingReport = CliTriggerResponse;

export async function runHousekeeping(opts: { dryRun?: boolean } = {}): Promise<HousekeepingReport> {
  if (opts.dryRun) {
    console.warn("⚠ --dry-run is not supported by the COG backend. The cog-housekeeping skill decides what to change; running for real.");
  }
  return triggerCogSkillViaApi("housekeeping", true);
}

export function printReportSummary(report: HousekeepingReport, _dryRun: boolean): void {
  if (report.ok) {
    console.log("✓ cog-housekeeping dispatched to the orchestrator.");
    console.log("  The skill runs in the background; tail daemon logs for progress.");
    if (report.details && Object.keys(report.details).length > 0) {
      console.log(JSON.stringify(report.details, null, 2));
    }
    return;
  }
  if (report.error) {
    console.error(`✗ ${report.error}`);
  } else if (report.reason) {
    console.error(`✗ housekeeping refused: ${report.reason}`);
  } else {
    console.error(`✗ housekeeping failed (HTTP ${report.httpStatus})`);
  }
  process.exitCode = 1;
}
