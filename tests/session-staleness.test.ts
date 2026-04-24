import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  computeOrchestratorSessionFingerprint,
  syncOrchestratorSessionFingerprint,
} from "../src/cog/fingerprint.ts";

function createTempTree(): string {
  return mkdtempSync(join(tmpdir(), "max-session-staleness-"));
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test("computeOrchestratorSessionFingerprint changes when a user agent file changes", () => {
  const root = createTempTree();

  try {
    const agentsDir = join(root, "agents");
    const skillsDir = join(root, "skills");
    const systemPath = join(root, "cog", "SYSTEM.md");
    const hotMemoryPath = join(root, "cog", "memory", "hot-memory.md");
    const patternsPath = join(root, "cog", "memory", "cog-meta", "patterns.md");
    const foresightPath = join(root, "cog", "memory", "cog-meta", "foresight-nudge.md");
    const domainsPath = join(root, "cog", "memory", "domains.yml");

    write(join(skillsDir, "sample-skill", "SKILL.md"), "---\nname: sample\ndescription: sample\n---\n");
    write(systemPath, "# System");
    write(hotMemoryPath, "# Hot Memory");
    write(patternsPath, "# Patterns");
    write(foresightPath, "# Foresight");
    write(domainsPath, "domains: []\n");
    write(join(agentsDir, "coder.agent.md"), "---\nname: Coder\ndescription: code\nmodel: claude-sonnet-4.6\n---\nInitial prompt\n");

    const before = computeOrchestratorSessionFingerprint({
      skillDirectories: [skillsDir],
      agentDirectories: [agentsDir],
      systemPaths: [systemPath],
      l0Paths: [hotMemoryPath, patternsPath, foresightPath, domainsPath],
    });

    write(join(agentsDir, "coder.agent.md"), "---\nname: Coder\ndescription: code\nmodel: claude-sonnet-4.6\n---\nUpdated prompt\n");

    const after = computeOrchestratorSessionFingerprint({
      skillDirectories: [skillsDir],
      agentDirectories: [agentsDir],
      systemPaths: [systemPath],
      l0Paths: [hotMemoryPath, patternsPath, foresightPath, domainsPath],
    });

    assert.notEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("computeOrchestratorSessionFingerprint changes when a skill file changes", () => {
  const root = createTempTree();

  try {
    const agentsDir = join(root, "agents");
    const skillsDir = join(root, "skills");
    const systemPath = join(root, "cog", "SYSTEM.md");
    const hotMemoryPath = join(root, "cog", "memory", "hot-memory.md");
    const patternsPath = join(root, "cog", "memory", "cog-meta", "patterns.md");
    const foresightPath = join(root, "cog", "memory", "cog-meta", "foresight-nudge.md");
    const domainsPath = join(root, "cog", "memory", "domains.yml");

    write(join(agentsDir, "coder.agent.md"), "---\nname: Coder\ndescription: code\nmodel: claude-sonnet-4.6\n---\nPrompt\n");
    write(join(skillsDir, "sample-skill", "SKILL.md"), "---\nname: sample\ndescription: sample\n---\nFirst\n");
    write(join(skillsDir, "sample-skill", "_meta.json"), "{\n  \"slug\": \"sample-skill\"\n}\n");
    write(systemPath, "# System");
    write(hotMemoryPath, "# Hot Memory");
    write(patternsPath, "# Patterns");
    write(foresightPath, "# Foresight");
    write(domainsPath, "domains: []\n");

    const before = computeOrchestratorSessionFingerprint({
      skillDirectories: [skillsDir],
      agentDirectories: [agentsDir],
      systemPaths: [systemPath],
      l0Paths: [hotMemoryPath, patternsPath, foresightPath, domainsPath],
    });

    write(join(skillsDir, "sample-skill", "SKILL.md"), "---\nname: sample\ndescription: sample\n---\nSecond\n");

    const after = computeOrchestratorSessionFingerprint({
      skillDirectories: [skillsDir],
      agentDirectories: [agentsDir],
      systemPaths: [systemPath],
      l0Paths: [hotMemoryPath, patternsPath, foresightPath, domainsPath],
    });

    assert.notEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("computeOrchestratorSessionFingerprint changes when L0 memory changes", () => {
  const root = createTempTree();

  try {
    const agentsDir = join(root, "agents");
    const skillsDir = join(root, "skills");
    const systemPath = join(root, "cog", "SYSTEM.md");
    const hotMemoryPath = join(root, "cog", "memory", "hot-memory.md");
    const patternsPath = join(root, "cog", "memory", "cog-meta", "patterns.md");
    const foresightPath = join(root, "cog", "memory", "cog-meta", "foresight-nudge.md");
    const domainsPath = join(root, "cog", "memory", "domains.yml");

    write(join(agentsDir, "coder.agent.md"), "---\nname: Coder\ndescription: code\nmodel: claude-sonnet-4.6\n---\nPrompt\n");
    write(join(skillsDir, "sample-skill", "SKILL.md"), "---\nname: sample\ndescription: sample\n---\n");
    write(systemPath, "# System");
    write(hotMemoryPath, "# Hot Memory");
    write(patternsPath, "# Patterns");
    write(foresightPath, "# Foresight");
    write(domainsPath, "domains: []\n");

    const before = computeOrchestratorSessionFingerprint({
      skillDirectories: [skillsDir],
      agentDirectories: [agentsDir],
      systemPaths: [systemPath],
      l0Paths: [hotMemoryPath, patternsPath, foresightPath, domainsPath],
    });

    write(hotMemoryPath, "# Hot Memory\n- updated");

    const after = computeOrchestratorSessionFingerprint({
      skillDirectories: [skillsDir],
      agentDirectories: [agentsDir],
      systemPaths: [systemPath],
      l0Paths: [hotMemoryPath, patternsPath, foresightPath, domainsPath],
    });

    assert.notEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncOrchestratorSessionFingerprint invalidates an existing session when the fingerprint changes", () => {
  let storedFingerprint = "old-fingerprint";
  let clearedSession = false;

  const status = syncOrchestratorSessionFingerprint("new-fingerprint", {
    readFingerprint: () => storedFingerprint,
    writeFingerprint: (value) => {
      storedFingerprint = value;
    },
    clearPersistedSession: () => {
      clearedSession = true;
    },
  });

  assert.equal(status, "invalidated");
  assert.equal(storedFingerprint, "new-fingerprint");
  assert.equal(clearedSession, true);
});
