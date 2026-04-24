import { existsSync, renameSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { MAX_HOME, COG_SOURCES_DIR, COG_META_DIR } from "../paths.js";
import { getState, setState } from "../store/db.js";

const STATE_KEY = "cog_wiki_archived";
const LEGACY_WIKI_DIR = join(MAX_HOME, "wiki");
const ARCHIVE_DIR = join(COG_SOURCES_DIR, "wiki-archive");

/**
 * One-shot, idempotent move of ~/.max/wiki/ into ~/.max/cog/sources/wiki-archive/.
 * No parsing, no re-classification. The COG pipeline can surface its contents
 * over time. Returns true if a move actually happened on this call.
 */
export function migrateWikiToCog(): boolean {
  if (getState(STATE_KEY)) return false;
  if (!existsSync(LEGACY_WIKI_DIR)) {
    setState(STATE_KEY, new Date().toISOString());
    return false;
  }

  try {
    mkdirSync(COG_SOURCES_DIR, { recursive: true });
    // If the archive directory already exists (partial previous attempt), nest
    // with a timestamp to avoid clobbering.
    const target = existsSync(ARCHIVE_DIR)
      ? `${ARCHIVE_DIR}-${Date.now()}`
      : ARCHIVE_DIR;
    renameSync(LEGACY_WIKI_DIR, target);
    setState(STATE_KEY, new Date().toISOString());
    noteMigration(target);
    return true;
  } catch (err) {
    console.error(
      "[cog] Wiki archive migration failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

function noteMigration(archivePath: string): void {
  try {
    const selfObs = join(COG_META_DIR, "self-observations.md");
    if (!existsSync(selfObs)) return;
    const stamp = new Date().toISOString().slice(0, 10);
    appendFileSync(
      selfObs,
      `\n- ${stamp} [migrate, system]: archived legacy ~/.max/wiki/ to ${archivePath}. Pending surfacing by cog-reflect.\n`
    );
  } catch {
    // best effort
  }
}
