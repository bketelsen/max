// ---------------------------------------------------------------------------
// Wiki context retrieval — index-first, ranked injection per message
// ---------------------------------------------------------------------------

import { parseIndex, type IndexEntry } from "./index-manager.js";
import { ensureWikiStructure } from "./fs.js";

const INDEX_BUDGET_CHARS = 4000;

/**
 * Get the wiki index as context, ranked by relevance to the current query.
 * This is the primary per-message injection point. It gives the LLM a
 * "table of contents" of everything Max knows, on every turn.
 *
 * Ranking: (a) keyword-matching entries, (b) recently updated, (c) remaining alphabetically.
 * Truncates to INDEX_BUDGET_CHARS with a clear marker.
 */
export function getRelevantWikiContext(query: string, _maxPages = 3): string {
  ensureWikiStructure();

  const entries = parseIndex();
  if (entries.length === 0) return "";

  const cleanQuery = query.replace(/^\[via (?:telegram|tui)\]\s*/i, "").trim();
  const queryWords = new Set(
    cleanQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );

  // Score each entry
  const now = Date.now();
  const scored = entries.map((entry) => {
    let score = 0;

    // Keyword relevance
    if (queryWords.size > 0) {
      const text = `${entry.title} ${entry.summary} ${(entry.tags || []).join(" ")}`.toLowerCase();
      for (const q of queryWords) {
        if (text.includes(q)) score += 10;
      }
      // Tag exact match bonus
      for (const tag of entry.tags || []) {
        for (const q of queryWords) {
          if (tag.toLowerCase() === q) score += 5;
        }
      }
    }

    // Recency boost
    if (entry.updated) {
      const daysSince = (now - new Date(entry.updated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 3) score += 3;
      else if (daysSince < 7) score += 2;
      else if (daysSince < 30) score += 1;
    }

    return { entry, score };
  });

  // Sort: highest score first, then alphabetically by title
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.title.localeCompare(b.entry.title);
  });

  // Group by section and format
  const sections = new Map<string, string[]>();
  let totalChars = 0;
  let included = 0;
  const totalEntries = scored.length;

  for (const { entry } of scored) {
    const line = formatEntry(entry);
    if (totalChars + line.length > INDEX_BUDGET_CHARS) continue;
    const list = sections.get(entry.section) || [];
    list.push(line);
    sections.set(entry.section, list);
    totalChars += line.length;
    included++;
  }

  const parts: string[] = ["## Your Wiki Knowledge Base"];
  for (const [section, items] of sections) {
    parts.push(`**${section}:** ${items.join("; ")}`);
  }

  if (included < totalEntries) {
    parts.push(`_(${totalEntries - included} more pages in wiki — use wiki_search or recall for full list)_`);
  }

  return parts.join("\n");
}

function formatEntry(entry: IndexEntry): string {
  let item = `${entry.title}: ${entry.summary}`;
  if (entry.tags?.length) item += ` [${entry.tags.join(", ")}]`;
  if (entry.updated) item += ` (${entry.updated})`;
  return item;
}

/**
 * Get a summary of the wiki for the system message / recovery context.
 * Returns the index summary (compact list of all pages).
 */
export function getWikiSummary(): string {
  ensureWikiStructure();
  const entries = parseIndex();
  if (entries.length === 0) return "";

  const sections = new Map<string, string[]>();
  for (const e of entries) {
    const list = sections.get(e.section) || [];
    list.push(formatEntry(e));
    sections.set(e.section, list);
  }

  const parts: string[] = [];
  for (const [section, items] of sections) {
    parts.push(`**${section}**: ${items.join("; ")}`);
  }
  return parts.join("\n");
}
