import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const originalHome = process.env.HOME;
const tempHome = mkdtempSync(join(tmpdir(), "max-agent-skill-loading-"));
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

function writeLocalSkill(slug: string, name: string, description: string): void {
  const skillDir = join(tempHome, ".max", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "_meta.json"), JSON.stringify({ slug, version: "1.0.0" }, null, 2) + "\n");
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---

Local override for ${slug}.
`
  );
}

test("parseAgentMd preserves multiline YAML arrays in .agent.md frontmatter", async () => {
  const agentsModule = await import(uniqueImport("../src/copilot/agents.ts"));

  const config = agentsModule.parseAgentMd(
    `---
name: Designer
description: UI specialist
model: claude-opus-4.6
skills:
  - frontend-design
  - shadcn
tools:
  - bash
  - view
mcpServers:
  - github
---

You are Designer.
`,
    "designer"
  );

  assert.ok(config);
  assert.deepEqual(config.skills, ["frontend-design", "shadcn"]);
  assert.deepEqual(config.tools, ["bash", "view"]);
  assert.deepEqual(config.mcpServers, ["github"]);
});

test("parseAgentMd preserves multiline YAML arrays with comments in .agent.md frontmatter", async () => {
  const agentsModule = await import(uniqueImport("../src/copilot/agents.ts"));

  const config = agentsModule.parseAgentMd(
    `---
name: Architect
description: Planning specialist
model: claude-opus-4.6
skills:
  - brainstorming
  # Keep critique available for design review.
  - code-review
tools:
  - view
  # Shell access is needed for repo inspection.
  - bash
---

You are Architect.
`,
    "architect"
  );

  assert.ok(config);
  assert.deepEqual(config.skills, ["brainstorming", "code-review"]);
  assert.deepEqual(config.tools, ["view", "bash"]);
});

test("ensureDefaultAgents warns when the bundled agents directory is missing", async () => {
  const agentsModule = await import(uniqueImport("../src/copilot/agents.ts"));
  const warnings: string[] = [];
  const missingBundledDir = join(tempHome, "missing-bundled-agents");

  agentsModule.ensureDefaultAgents({
    bundledDir: missingBundledDir,
    logger: {
      warn(message: string) {
        warnings.push(message);
      },
    },
  });

  assert.deepEqual(warnings, [
    `[agents] Bundled agents directory not found: ${missingBundledDir}`,
  ]);
  assert.equal(existsSync(join(tempHome, ".max", "agents")), true);
  assert.deepEqual(readdirSync(join(tempHome, ".max", "agents")), []);
});

test("listSkills prefers local skills over bundled skills when slugs collide", async () => {
  writeLocalSkill("find-skills", "Local Find Skills", "Local override description");

  const skillsModule = await import(uniqueImport("../src/copilot/skills.ts"));
  const skills = skillsModule.listSkills();
  const findSkills = skills.filter((skill: { slug: string }) => skill.slug === "find-skills");

  assert.equal(findSkills.length, 1);
  assert.equal(findSkills[0]?.source, "local");
  assert.equal(findSkills[0]?.name, "Local Find Skills");
  assert.equal(findSkills[0]?.description, "Local override description");
});

test("getSkillDirectories builds a deduplicated runtime skills directory with local overrides", async () => {
  writeLocalSkill("find-skills", "Local Find Skills", "Local override description");

  const skillsModule = await import(uniqueImport("../src/copilot/skills.ts"));
  const resolvedDir = join(tempHome, ".max", "resolved-skills");
  const directories = skillsModule.getSkillDirectories({ resolvedDir });

  assert.deepEqual(directories, [resolvedDir]);
  assert.equal(
    existsSync(join(resolvedDir, "find-skills", "SKILL.md")),
    true
  );
  assert.match(
    readFileSync(join(resolvedDir, "find-skills", "SKILL.md"), "utf-8"),
    /Local Find Skills/
  );

  const skillSource = readdirSync(resolvedDir).filter((entry) => entry === "find-skills");
  assert.deepEqual(skillSource, ["find-skills"]);
});

test("getSkillDirectories warns when the bundled skills directory is missing", async () => {
  const skillsModule = await import(uniqueImport("../src/copilot/skills.ts"));
  const warnings: string[] = [];
  const localDir = join(tempHome, ".max", "skills");
  const globalDir = join(tempHome, ".agents", "skills");
  const missingBundledDir = join(tempHome, "missing-bundled-skills");
  const resolvedDir = join(tempHome, ".max", "resolved-skills-missing-bundled");

  mkdirSync(localDir, { recursive: true });

  const directories = skillsModule.getSkillDirectories({
    bundledDir: missingBundledDir,
    localDir,
    globalDir,
    resolvedDir,
    logger: {
      warn(message: string) {
        warnings.push(message);
      },
    },
  });

  assert.deepEqual(directories, [resolvedDir]);
  assert.deepEqual(warnings, [
    `[skills] Bundled skills directory not found: ${missingBundledDir}`,
  ]);
});

test("every bundled skill directory includes _meta.json", () => {
  const bundledSkillsDir = fileURLToPath(new URL("../skills", import.meta.url));
  const skillDirs = readdirSync(bundledSkillsDir).filter((entry) =>
    existsSync(join(bundledSkillsDir, entry, "SKILL.md"))
  );

  for (const slug of skillDirs) {
    assert.equal(
      existsSync(join(bundledSkillsDir, slug, "_meta.json")),
      true,
      `Expected bundled skill '${slug}' to include _meta.json`
    );
  }
});
