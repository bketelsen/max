// ---------------------------------------------------------------------------
// Skill-set fingerprint — detect when bundled skills or the bundled system
// prompt have changed so the daemon can invalidate its saved orchestrator
// session. Copilot SDK registers skills at session-CREATE time; resuming an
// old session keeps the stale <available_skills> list. Invalidating the
// persisted orchestrator_session_id forces a fresh createSession next boot,
// which picks up the current skill metadata.
// ---------------------------------------------------------------------------

import { createHash } from "crypto";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getState, setState, deleteState } from "../store/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = join(__dirname, "..", "..", "skills");
const BUNDLED_SYSTEM_MD = join(__dirname, "default-system.md");

const FINGERPRINT_KEY = "bundled_skill_fingerprint";
const SESSION_KEY = "orchestrator_session_id";

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

/** Hash all SKILL.md + _meta.json under /skills/ plus the bundled system.md. */
export function computeBundleFingerprint(): string {
  const hash = createHash("sha256");

  if (existsSync(BUNDLED_SKILLS_DIR)) {
    let slugs: string[] = [];
    try {
      slugs = readdirSync(BUNDLED_SKILLS_DIR).sort();
    } catch {
      slugs = [];
    }
    for (const slug of slugs) {
      const dir = join(BUNDLED_SKILLS_DIR, slug);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      hashFileIfExists(hash, join(dir, "SKILL.md"));
      hashFileIfExists(hash, join(dir, "_meta.json"));
    }
  }

  hashFileIfExists(hash, BUNDLED_SYSTEM_MD);

  return hash.digest("hex");
}

/**
 * If the current bundle fingerprint differs from the stored one, delete the
 * persisted orchestrator session so the next boot creates a fresh one.
 * Returns true when invalidation fired.
 */
export function invalidateSessionIfBundleChanged(): boolean {
  const current = computeBundleFingerprint();
  const stored = getState(FINGERPRINT_KEY);

  if (stored === current) return false;

  // First run (no stored fingerprint): record it but don't force-invalidate a
  // possibly-innocent existing session. Only invalidate when we see a real diff.
  if (!stored) {
    setState(FINGERPRINT_KEY, current);
    return false;
  }

  deleteState(SESSION_KEY);
  setState(FINGERPRINT_KEY, current);
  return true;
}
