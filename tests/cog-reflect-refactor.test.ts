import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalHome = process.env.HOME;
const tempHome = mkdtempSync(join(tmpdir(), "max-cog-reflect-"));
process.env.HOME = tempHome;

after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tempHome, { recursive: true, force: true });
});

function uniqueImport(specifier: string): string {
  return `${specifier}?test=${Date.now()}-${Math.random()}`;
}

test("scheduler source no longer owns recent-conversations dumping or conversation_log cursoring", () => {
  const schedulerPath = new URL("../src/cog/scheduler.ts", import.meta.url);
  const schedulerSource = readFileSync(schedulerPath, "utf-8");

  assert.doesNotMatch(schedulerSource, /recent-conversations\.md/);
  assert.doesNotMatch(schedulerSource, /conversation_log/);
  assert.doesNotMatch(schedulerSource, /KEY_LAST_CONVO_ID/);
  assert.doesNotMatch(schedulerSource, /dumpRecentConversations/);
  assert.doesNotMatch(schedulerSource, /updateReflectCursorFile/);
});

test("buildReflectPrompt tells cog-reflect to query session-store and own the cursor", async () => {
  const schedulerModule = await import(uniqueImport("../src/cog/scheduler.ts"));

  assert.equal(typeof schedulerModule.buildReflectPrompt, "function");

  const prompt = schedulerModule.buildReflectPrompt();
  assert.match(prompt, /session-store\.db/);
  assert.match(prompt, /new turns since your cursor/i);
  assert.match(prompt, /You own the cursor/i);
  assert.doesNotMatch(prompt, /recent-conversations\.md/);
});

test("reflect lock blocks duplicate runs until released or stale", async () => {
  const locksModule = await import(uniqueImport("../src/cog/locks.ts"));
  const dbModule = await import(uniqueImport("../src/store/db.ts"));

  assert.equal(typeof locksModule.acquireReflectLock, "function");
  assert.equal(typeof locksModule.releaseReflectLock, "function");
  assert.equal(locksModule.acquireReflectLock(), true);
  assert.equal(locksModule.acquireReflectLock(), false);

  locksModule.releaseReflectLock();
  assert.equal(locksModule.acquireReflectLock(), true);

  dbModule.setState("reflect_running", String(Date.now() - locksModule.LOCK_TTL_MS - 1));
  assert.equal(locksModule.acquireReflectLock(), true);
});

test("ensureCogStructure seeds a turn-based reflect cursor and does not create recent-conversations.md", async () => {
  const { ensureCogStructure } = await import(uniqueImport("../src/cog/fs.ts"));
  ensureCogStructure();

  const reflectCursorPath = join(tempHome, ".max", "cog", "memory", "cog-meta", "reflect-cursor.md");
  const recentConversationsPath = join(tempHome, ".max", "cog", "memory", "cog-meta", "recent-conversations.md");
  const reflectCursor = readFileSync(reflectCursorPath, "utf-8");

  assert.match(reflectCursor, /last_turn_id: 0/);
  assert.match(reflectCursor, /source: session_store \(SQL\)/);
  assert.equal(existsSync(recentConversationsPath), false);
});
