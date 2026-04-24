import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync, cpSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { RESOLVED_SKILLS_DIR, SKILLS_DIR } from "../paths.js";

/** User-local skills directory (~/.max/skills/) */
const LOCAL_SKILLS_DIR = SKILLS_DIR;

/** Global shared skills directory */
const GLOBAL_SKILLS_DIR = join(homedir(), ".agents", "skills");

/** Skills bundled with the Max package (e.g. find-skills) */
const BUNDLED_SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills"
);

interface SkillDirectoryOptions {
  bundledDir?: string;
  localDir?: string;
  globalDir?: string;
  resolvedDir?: string;
  logger?: Pick<Console, "warn">;
}

/** Returns all skill directories that exist on disk. */
export function getSkillDirectories(options: SkillDirectoryOptions = {}): string[] {
  const skills = collectSkills(options);
  if (skills.length === 0) return [];

  const resolvedDir = options.resolvedDir ?? RESOLVED_SKILLS_DIR;
  mkdirSync(resolvedDir, { recursive: true });

  const expectedSlugs = new Set(skills.map((skill) => skill.slug));
  let existingEntries: string[] = [];
  try {
    existingEntries = readdirSync(resolvedDir);
  } catch {
    existingEntries = [];
  }

  for (const entry of existingEntries) {
    if (!expectedSlugs.has(entry)) {
      rmSync(join(resolvedDir, entry), { recursive: true, force: true });
    }
  }

  for (const skill of skills) {
    const destination = join(resolvedDir, skill.slug);
    rmSync(destination, { recursive: true, force: true });
    cpSync(skill.directory, destination, { recursive: true });
  }

  return [resolvedDir];
}

export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  directory: string;
  source: "bundled" | "local" | "global";
}

interface SkillSourceDirectory {
  directory: string;
  source: SkillInfo["source"];
}

const SOURCE_PRECEDENCE: Record<SkillInfo["source"], number> = {
  bundled: 0,
  global: 1,
  local: 2,
};

/** Scan all skill directories and return metadata for each skill found. */
export function listSkills(options: SkillDirectoryOptions = {}): SkillInfo[] {
  return collectSkills(options);
}

/** Create a new skill in the local skills directory. */
export function createSkill(slug: string, name: string, description: string, instructions: string): string {
  const skillDir = join(LOCAL_SKILLS_DIR, slug);
  // Guard against path traversal
  if (!skillDir.startsWith(LOCAL_SKILLS_DIR + "/")) {
    return `Invalid slug '${slug}': must be a simple kebab-case name without path separators.`;
  }
  if (existsSync(skillDir)) {
    return `Skill '${slug}' already exists at ${skillDir}. Edit it directly or delete it first.`;
  }

  mkdirSync(skillDir, { recursive: true });

  writeFileSync(
    join(skillDir, "_meta.json"),
    JSON.stringify({ slug, version: "1.0.0" }, null, 2) + "\n"
  );

  const skillMd = `---
name: ${name}
description: ${description}
---

${instructions}
`;
  writeFileSync(join(skillDir, "SKILL.md"), skillMd);

  return `Skill '${name}' created at ${skillDir}. It will be available on your next message.`;
}

/** Remove a skill from the local skills directory (~/.max/skills/). */
export function removeSkill(slug: string): { ok: boolean; message: string } {
  const skillDir = join(LOCAL_SKILLS_DIR, slug);
  // Guard against path traversal
  if (!skillDir.startsWith(LOCAL_SKILLS_DIR + "/")) {
    return { ok: false, message: `Invalid slug '${slug}': must be a simple kebab-case name without path separators.` };
  }
  if (!existsSync(skillDir)) {
    return { ok: false, message: `Skill '${slug}' not found in ${LOCAL_SKILLS_DIR}.` };
  }

  rmSync(skillDir, { recursive: true, force: true });
  return { ok: true, message: `Skill '${slug}' removed from ${skillDir}. It will no longer be available on your next message.` };
}

/** Parse YAML frontmatter from a SKILL.md file. */
function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: "", description: "" };

  const frontmatter = match[1];
  let name = "";
  let description = "";

  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 2).trim();
    if (key === "name") name = value;
    if (key === "description") description = value;
  }

  return { name, description };
}

function collectSkills(options: SkillDirectoryOptions): SkillInfo[] {
  const skillsBySlug = new Map<string, SkillInfo>();

  for (const sourceDir of getSkillSourceDirectories(options)) {
    for (const skill of readSkillsFromDirectory(sourceDir)) {
      const existing = skillsBySlug.get(skill.slug);
      if (!existing || SOURCE_PRECEDENCE[skill.source] >= SOURCE_PRECEDENCE[existing.source]) {
        skillsBySlug.set(skill.slug, skill);
      }
    }
  }

  return Array.from(skillsBySlug.values());
}

function getSkillSourceDirectories(options: SkillDirectoryOptions): SkillSourceDirectory[] {
  const dirs: SkillSourceDirectory[] = [];
  const bundledDir = options.bundledDir ?? BUNDLED_SKILLS_DIR;
  const localDir = options.localDir ?? LOCAL_SKILLS_DIR;
  const globalDir = options.globalDir ?? GLOBAL_SKILLS_DIR;
  const logger = options.logger ?? console;

  if (existsSync(bundledDir)) {
    dirs.push({ directory: bundledDir, source: "bundled" });
  } else {
    logger.warn(`[skills] Bundled skills directory not found: ${bundledDir}`);
  }

  if (existsSync(globalDir)) dirs.push({ directory: globalDir, source: "global" });
  if (existsSync(localDir)) dirs.push({ directory: localDir, source: "local" });

  return dirs;
}

function readSkillsFromDirectory(sourceDir: SkillSourceDirectory): SkillInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(sourceDir.directory);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    const skillDir = join(sourceDir.directory, entry);
    const skillMd = join(skillDir, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    try {
      const content = readFileSync(skillMd, "utf-8");
      const { name, description } = parseFrontmatter(content);
      skills.push({
        slug: entry,
        name: name || entry,
        description: description || "(no description)",
        directory: skillDir,
        source: sourceDir.source,
      });
    } catch {
      skills.push({
        slug: entry,
        name: entry,
        description: "(could not read SKILL.md)",
        directory: skillDir,
        source: sourceDir.source,
      });
    }
  }

  return skills;
}
