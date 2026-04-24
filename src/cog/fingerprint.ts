// ---------------------------------------------------------------------------
// Orchestrator session fingerprint — detect when any prompt-shaping input has
// changed so Max can recreate its persistent orchestrator session. This covers
// bundled/local/global skills, bundled/user agents, the user-editable COG
// system prompt, and the injected L0 memory payload.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  AGENTS_DIR,
  COG_DOMAINS_PATH,
  COG_MEMORY_DIR,
  COG_META_DIR,
  COG_SYSTEM_PATH,
  SKILLS_DIR,
} from "../paths.js";
import { getState, setState, deleteState } from "../store/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = join(__dirname, "..", "..", "skills");
const BUNDLED_AGENTS_DIR = join(__dirname, "..", "..", "agents");
const GLOBAL_SKILLS_DIR = join(dirname(SKILLS_DIR), "..", ".agents", "skills");
const BUNDLED_SYSTEM_MD = join(__dirname, "default-system.md");

const FINGERPRINT_KEY = "orchestrator_session_fingerprint";
const LEGACY_FINGERPRINT_KEY = "bundled_skill_fingerprint";
const SESSION_KEY = "orchestrator_session_id";

export type SessionFingerprintSyncStatus = "unchanged" | "initialized" | "invalidated";

export interface SessionFingerprintSyncOps {
  readFingerprint: () => string | undefined;
  writeFingerprint: (value: string) => void;
  clearPersistedSession: () => void;
  readLegacyFingerprint?: () => string | undefined;
  clearLegacyFingerprint?: () => void;
}

export interface OrchestratorFingerprintOptions {
  skillDirectories?: string[];
  agentDirectories?: string[];
  systemPaths?: string[];
  l0Paths?: string[];
}

function hashFileIfExists(hash: ReturnType<typeof createHash>, path: string): void {
  if (!existsSync(path)) return;
  try {
    hash.update(path + "\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  } catch {
    // best effort
  }
}

function sortedUnique(paths: string[]): string[] {
  return Array.from(new Set(paths)).sort();
}

function hashSkillDirectories(hash: ReturnType<typeof createHash>, directories: string[]): void {
  for (const baseDir of sortedUnique(directories)) {
    if (!existsSync(baseDir)) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(baseDir).sort();
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(baseDir, entry);
      try {
        if (!statSync(skillDir).isDirectory()) continue;
      } catch {
        continue;
      }
      hashFileIfExists(hash, join(skillDir, "SKILL.md"));
      hashFileIfExists(hash, join(skillDir, "_meta.json"));
    }
  }
}

function hashAgentDirectories(hash: ReturnType<typeof createHash>, directories: string[]): void {
  for (const baseDir of sortedUnique(directories)) {
    if (!existsSync(baseDir)) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(baseDir)
        .filter((entry) => entry.endsWith(".agent.md"))
        .sort();
    } catch {
      continue;
    }

    for (const entry of entries) {
      hashFileIfExists(hash, join(baseDir, entry));
    }
  }
}

export function computeOrchestratorSessionFingerprint(options: OrchestratorFingerprintOptions = {}): string {
  const hash = createHash("sha256");

  hashSkillDirectories(hash, options.skillDirectories ?? [
    BUNDLED_SKILLS_DIR,
    SKILLS_DIR,
    GLOBAL_SKILLS_DIR,
  ]);
  hashAgentDirectories(hash, options.agentDirectories ?? [
    BUNDLED_AGENTS_DIR,
    AGENTS_DIR,
  ]);

  for (const path of sortedUnique(options.systemPaths ?? [BUNDLED_SYSTEM_MD, COG_SYSTEM_PATH])) {
    hashFileIfExists(hash, path);
  }
  for (const path of sortedUnique(options.l0Paths ?? [
    join(COG_MEMORY_DIR, "hot-memory.md"),
    join(COG_META_DIR, "patterns.md"),
    join(COG_META_DIR, "foresight-nudge.md"),
    COG_DOMAINS_PATH,
  ])) {
    hashFileIfExists(hash, path);
  }

  return hash.digest("hex");
}

export function syncOrchestratorSessionFingerprint(
  currentFingerprint: string,
  ops: SessionFingerprintSyncOps
): SessionFingerprintSyncStatus {
  const primary = ops.readFingerprint();
  const legacy = primary === undefined ? ops.readLegacyFingerprint?.() : undefined;
  const stored = primary ?? legacy;
  const usingLegacy = primary === undefined && legacy !== undefined;

  if (stored === currentFingerprint) {
    ops.writeFingerprint(currentFingerprint);
    if (usingLegacy) ops.clearLegacyFingerprint?.();
    return "unchanged";
  }

  if (!stored) {
    ops.writeFingerprint(currentFingerprint);
    if (usingLegacy) ops.clearLegacyFingerprint?.();
    return "initialized";
  }

  ops.clearPersistedSession();
  ops.writeFingerprint(currentFingerprint);
  if (usingLegacy) ops.clearLegacyFingerprint?.();
  return "invalidated";
}

export function syncPersistedOrchestratorSessionFingerprint(): SessionFingerprintSyncStatus {
  return syncOrchestratorSessionFingerprint(computeOrchestratorSessionFingerprint(), {
    readFingerprint: () => getState(FINGERPRINT_KEY),
    writeFingerprint: (value) => {
      setState(FINGERPRINT_KEY, value);
    },
    clearPersistedSession: () => {
      deleteState(SESSION_KEY);
    },
    readLegacyFingerprint: () => getState(LEGACY_FINGERPRINT_KEY),
    clearLegacyFingerprint: () => {
      deleteState(LEGACY_FINGERPRINT_KEY);
    },
  });
}

export function invalidateSessionIfOrchestratorPromptChanged(): boolean {
  return syncPersistedOrchestratorSessionFingerprint() === "invalidated";
}
