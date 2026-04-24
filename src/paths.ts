import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

/** Base directory for all Max user data: ~/.max */
export const MAX_HOME = join(homedir(), ".max");

/** Path to the SQLite database */
export const DB_PATH = join(MAX_HOME, "max.db");

/** Path to the user .env file */
export const ENV_PATH = join(MAX_HOME, ".env");

/** Path to user-local skills */
export const SKILLS_DIR = join(MAX_HOME, "skills");

/** Path to Max's isolated session state (keeps CLI history clean) */
export const SESSIONS_DIR = join(MAX_HOME, "sessions");

/** Path to TUI readline history */
export const HISTORY_PATH = join(MAX_HOME, "tui_history");

/** Path to optional TUI debug log */
export const TUI_DEBUG_LOG_PATH = join(MAX_HOME, "tui-debug.log");

/** Path to the API bearer token file */
export const API_TOKEN_PATH = join(MAX_HOME, "api-token");

/** Agent definition files (~/.max/agents/) */
export const AGENTS_DIR = join(MAX_HOME, "agents");

/** Root of the COG memory system */
export const COG_DIR = join(MAX_HOME, "cog");

/** Active memory (domains, cog-meta, glacier index) */
export const COG_MEMORY_DIR = join(COG_DIR, "memory");

/** Cross-domain meta: patterns, self-observations, cursors */
export const COG_META_DIR = join(COG_MEMORY_DIR, "cog-meta");

/** Archived / condensed memory */
export const COG_GLACIER_DIR = join(COG_MEMORY_DIR, "glacier");

/** Immutable source dumps (including the wiki archive after migration) */
export const COG_SOURCES_DIR = join(COG_DIR, "sources");

/** Domain manifest (SSOT for registered domains) */
export const COG_DOMAINS_PATH = join(COG_MEMORY_DIR, "domains.yml");

/** Root system prompt, ported from COG's CLAUDE.md */
export const COG_SYSTEM_PATH = join(COG_DIR, "SYSTEM.md");

/** Ensure ~/.max/ exists */
export function ensureMaxHome(): void {
  mkdirSync(MAX_HOME, { recursive: true });
}
