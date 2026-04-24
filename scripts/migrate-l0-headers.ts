#!/usr/bin/env npx tsx
// ---------------------------------------------------------------------------
// Migration tool: Add or regenerate L0 summary headers for all wiki pages.
//
// L0 headers are placed AFTER YAML frontmatter (if present) so that
// frontmatter parsing continues to work. Format:
//   <!-- L0: One-line summary of page contents -->
//
// L0 Requirements:
//   - Full text, NO truncation with "..."
//   - Concise: <100 characters
//   - Descriptive: key identifier + essential context
//   - Em dash (—) not hyphen (-)
//
// Usage:
//   npx tsx scripts/migrate-l0-headers.ts              # Add missing L0s only
//   npx tsx scripts/migrate-l0-headers.ts --rewrite    # Regenerate ALL L0s
//   npx tsx scripts/migrate-l0-headers.ts --dry-run    # Preview (no writes)
//   npx tsx scripts/migrate-l0-headers.ts --rewrite --dry-run
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, relative } from "path";
import { homedir } from "os";

const WIKI_PAGES_DIR = join(homedir(), ".max", "wiki", "pages");
const DRY_RUN = process.argv.includes("--dry-run");
const REWRITE = process.argv.includes("--rewrite");

const L0_REGEX = /^<!--\s*L0:\s*.+\s*-->/;
const FRONTMATTER_REGEX = /^(---\s*\n[\s\S]*?\n---)\s*\n?/;

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/** Extract YAML front matter tags */
function extractTags(content: string): string[] {
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (!fmMatch) return [];
  const tagsLine = fmMatch[1].match(/^tags:\s*\[(.+)\]/m);
  if (tagsLine) {
    return tagsLine[1].split(",").map(t => t.trim().replace(/['"]/g, ""));
  }
  return [];
}

/** Extract H1 title from content body */
function extractTitle(content: string): string {
  const body = content.replace(FRONTMATTER_REGEX, "").replace(/^<!--.*-->\s*\n?/, "");
  const h1 = body.match(/^#\s+(.+)/m);
  return h1 ? h1[1].trim() : "";
}

/** Extract first substantive bullet/sentence from body */
function extractFirstFact(content: string): string {
  const body = content
    .replace(FRONTMATTER_REGEX, "")
    .replace(/^<!--.*-->\s*\n?/, "")
    .trim();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Strip leading bullet/list markers and trailing date stamps
    const clean = trimmed
      .replace(/^[-*]\s+/, "")
      .replace(/_\(\d{4}-\d{2}-\d{2}\)_$/, "")
      .trim();
    if (clean.length > 10) return clean;
  }
  return "";
}

/**
 * Generate a concise L0 summary (NO truncation with "...").
 * If content would exceed 100 chars, extract shorter/different content.
 */
function generateL0(content: string, filepath: string): string {
  const tags = extractTags(content);
  const title = extractTitle(content);
  const firstFact = extractFirstFact(content);
  const filename = filepath.split("/").pop()?.replace(/\.md$/, "") || "";
  const pathParts = filepath.split("/");
  const category = pathParts[pathParts.length - 2] || ""; // people, projects, facts, etc.

  // Helper: build summary from components, fitting within 100 chars
  function fit(...parts: string[]): string {
    const joined = parts.filter(Boolean).join(" — ");
    if (joined.length <= 100) return joined;
    // Try progressively shorter combinations
    for (let i = parts.length - 1; i >= 1; i--) {
      const shorter = parts.slice(0, i).filter(Boolean).join(" — ");
      if (shorter.length <= 100) return shorter;
    }
    return parts[0].slice(0, 100);
  }

  // Person pages: Name — relationship + birth year + key trait
  if (tags.includes("person") || category === "people") {
    const name = title || filename.charAt(0).toUpperCase() + filename.slice(1);
    // Extract relationship (wife, son, daughter) and birth year
    const relMatch = firstFact.match(/Brian's (\w+)/i);
    const bornMatch = firstFact.match(/born (\d{4}-\d{2}-\d{2})/i);
    const ageMatch = firstFact.match(/\(age (\d+)\)/i);
    const traitMatch = firstFact.match(/\.\s+([^.]+)$/);

    const rel = relMatch ? `Brian's ${relMatch[1]}` : "";
    const born = bornMatch ? `b.${bornMatch[1].slice(0, 7)}` : "";
    const age = ageMatch ? `age ${ageMatch[1]}` : "";
    const bornAge = [born, age].filter(Boolean).join(", ");

    // Try to include a key trait from the fact
    const traitRaw = traitMatch ? traitMatch[1].replace(/_\(\d{4}-\d{2}-\d{2}\)_$/, "").trim() : "";
    const trait = traitRaw.length > 0 && traitRaw.length < 50 ? traitRaw : "";

    return fit(name, [rel, bornAge].filter(Boolean).join(", "), trait);
  }

  // Project pages: Name — description
  if (tags.includes("project") || category === "projects") {
    const name = title || filename.charAt(0).toUpperCase() + filename.slice(1);
    // Extract a concise description from the first fact
    // Strip the "Name - " prefix if present
    const stripped = firstFact.replace(new RegExp(`^${name}[\\s/-]+`, "i"), "").trim();
    // Take up to first period for conciseness
    const short = stripped.split(".")[0].trim();
    return fit(name, short);
  }

  // Fact/preference/routine pages: use first fact directly, trimming if needed
  // But no "..." — if too long, take only the first clause
  if (firstFact) {
    if (firstFact.length <= 100) return firstFact;
    // Split on common delimiters and take enough clauses to fit
    const clauses = firstFact.split(/[.,;]\s+/);
    let built = clauses[0];
    for (let i = 1; i < clauses.length; i++) {
      const next = built + ", " + clauses[i];
      if (next.length <= 100) built = next;
      else break;
    }
    return built.length <= 100 ? built : built.slice(0, 100).replace(/\s+\S*$/, "");
  }

  // Fallback: generate from filename
  const base = filename.replace(/\.md$/, "");
  return base.split(/[-_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + " — wiki page";
}

function hasL0Header(content: string): boolean {
  if (L0_REGEX.test(content.split("\n")[0])) return true;
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (fmMatch) {
    const afterFm = content.slice(fmMatch[0].length);
    const firstLine = afterFm.split("\n").find(l => l.trim().length > 0);
    if (firstLine && L0_REGEX.test(firstLine.trim())) return true;
  }
  return false;
}

function removeL0Header(content: string): string {
  // Remove L0 at top
  if (L0_REGEX.test(content.split("\n")[0])) {
    return content.replace(/^<!--\s*L0:.*-->\s*\n?/, "");
  }
  // Remove L0 after frontmatter
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (fmMatch) {
    const afterFm = content.slice(fmMatch[0].length);
    const withoutL0 = afterFm.replace(/^(\s*<!--\s*L0:.*-->\s*\n?)/, "");
    return fmMatch[0] + withoutL0;
  }
  return content;
}

function addL0Header(content: string, l0Summary: string): string {
  const l0Line = `<!-- L0: ${l0Summary} -->`;
  const fmMatch = content.match(FRONTMATTER_REGEX);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    const rest = content.slice(fmMatch[0].length);
    return `${frontmatter}\n\n${l0Line}\n${rest}`;
  }
  return `${l0Line}\n${content}`;
}

// Validate no truncation in generated summary
function validateL0(summary: string, filepath: string): void {
  if (summary.includes("...")) {
    console.warn(`  WARN  ${filepath}: L0 contains "..." — review manually`);
  }
  if (summary.length > 100) {
    console.warn(`  WARN  ${filepath}: L0 is ${summary.length} chars (>100) — consider shortening`);
  }
}

// Main
const files = walkDir(WIKI_PAGES_DIR);
let migrated = 0;
let rewritten = 0;
let skipped = 0;

for (const file of files) {
  const rel = relative(WIKI_PAGES_DIR, file);
  const content = readFileSync(file, "utf-8");
  const alreadyHasL0 = hasL0Header(content);

  if (alreadyHasL0 && !REWRITE) {
    console.log(`  SKIP  ${rel} (already has L0)`);
    skipped++;
    continue;
  }

  const l0Summary = generateL0(content, file);
  validateL0(l0Summary, rel);

  if (alreadyHasL0 && REWRITE) {
    const stripped = removeL0Header(content);
    const updated = addL0Header(stripped, l0Summary);
    if (DRY_RUN) {
      console.log(`  [DRY] REWRITE ${rel} → L0: ${l0Summary}`);
    } else {
      writeFileSync(file, updated, "utf-8");
      console.log(`  REWRITE ${rel} → L0: ${l0Summary}`);
    }
    rewritten++;
  } else {
    const updated = addL0Header(content, l0Summary);
    if (DRY_RUN) {
      console.log(`  [DRY] ADD ${rel} → L0: ${l0Summary}`);
    } else {
      writeFileSync(file, updated, "utf-8");
      console.log(`  ADD   ${rel} → L0: ${l0Summary}`);
    }
    migrated++;
  }
}

console.log(`\nDone. Added: ${migrated}, Rewritten: ${rewritten}, Skipped: ${skipped}, Total: ${files.length}`);
if (DRY_RUN) console.log("(dry run — no files modified)");

