import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

function freshModuleUrl(relativePath: string): string {
  const url = pathToFileURL(join(process.cwd(), relativePath));
  url.search = `t=${Date.now()}-${Math.random()}`;
  return url.href;
}

test("getCogStartupContext warns when L0 sections are truncated or dropped for budget", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "max-l0-truncation-"));
  const originalHome = process.env.HOME;
  const warnings: string[] = [];
  const originalWarn = console.warn;

  process.env.HOME = tempHome;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const memoryDir = join(tempHome, ".max", "cog", "memory");
    const metaDir = join(memoryDir, "cog-meta");
    mkdirSync(metaDir, { recursive: true });

    writeFileSync(join(memoryDir, "hot-memory.md"), "hot\n".repeat(1200));
    writeFileSync(join(metaDir, "patterns.md"), "pattern\n".repeat(1200));
    writeFileSync(join(metaDir, "foresight-nudge.md"), "foresight\n".repeat(600));

    const systemMessage = await import(freshModuleUrl("src/copilot/system-message.ts"));
    const context = systemMessage.getCogStartupContext();

    assert.match(context, /## Current L0 Memory/);
    assert.ok(warnings.some((entry) => entry.includes("Hot Memory") && entry.includes("truncated")));
    assert.ok(warnings.some((entry) => entry.includes("Patterns (universal)") && entry.includes("truncated")));
    assert.ok(warnings.some((entry) => entry.includes("Foresight Nudge (last 24h)") && (entry.includes("dropped") || entry.includes("skipped"))));
  } finally {
    console.warn = originalWarn;
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});
