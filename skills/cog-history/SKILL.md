---
name: cog-history
description: Cog History — deep memory search and recall across all domains. Use when the user says "what did I say about X", "when did we discuss Y", "find that conversation", "history of Z", or asks to dig up past context. Three-pass grep/locate/synthesize across observations, entities, threads, and glacier.
---

<!--
Ported from marciopuga/cog (MIT) — see LICENSE-COG.md at the Max repo root.
Adapted for Max's GitHub Copilot SDK runtime.
-->

## Max Runtime Adapter (read first)

This skill is a port of an upstream Claude-Code-native COG skill. When the upstream prompt below refers to anything below, apply the following translation:

- **`memory/...` paths** — these are relative to `~/.max/cog/memory/`. Use absolute paths when invoking file tools: e.g. `memory/cog-meta/patterns.md` → `~/.max/cog/memory/cog-meta/patterns.md`.
- **Skill files (`.claude/commands/<name>.md`)** — live at `skills/cog-<name>/SKILL.md`. There are **two storage roots**, both scanned on daemon startup:
  - **Bundled**: the Max installation's `skills/` directory (ships with the package, shared, **read-only from your perspective**). Use `list_skills` to discover full paths and read them as reference/templates.
  - **Local**: `~/.max/skills/` (user-owned, writable). **Always write new skill files here**, using absolute paths: `~/.max/skills/cog-<name>/SKILL.md` and `~/.max/skills/cog-<name>/_meta.json`. `list_skills` will register them as `source: "local"` on the next session.
  - **Never write to the bundled tree** — it's source code, shared, and overwritten on update. If you'd harm a file by writing it, it's bundled; check `list_skills` if unsure.
- **`~/.claude/projects/*.jsonl` session transcripts** — Max does NOT have these. Instead, read `~/.max/cog/memory/cog-meta/recent-conversations.md`. That file is a markdown chronicle of new `conversation_log` rows, dumped by the `cog-scheduler` right before this skill is invoked. Each block is a user or Max turn with source tag, timestamp, and id. Do NOT look for `.jsonl` files. The ingestion cursor lives in `~/.max/cog/memory/cog-meta/reflect-cursor.md` and is advanced by the scheduler — do not rewrite it, do not try to "discover" a transcript path.
- **Slash commands** (`/reflect`, `/housekeeping`, `/foresight`, `/scenario`, `/setup`, etc.) — these map to Max skills with the `cog-` prefix (`cog-reflect`, `cog-housekeeping`, etc.). When the upstream tells you to "run /X", it means: invoke or behave as the `cog-X` skill.
- **Shell commands** (`find`, `grep`, `git diff`) — use Copilot CLI's built-in `Grep`, `Glob`, and Bash tools against the absolute `~/.max/cog/memory/` paths.
- **Read/Edit/Write/Glob/Grep tools** — Copilot CLI provides these under the same verbs. Use them directly.
- **CLAUDE.md** — the equivalent is `~/.max/cog/SYSTEM.md`. Do not modify it during this skill unless explicitly instructed.
- **Git operations** — Max's working directory is not necessarily a git repo. For the cog-commit skill, operate on the user's current project directory as conveyed by the user; for everything else, skip git-specific steps.

Treat everything under `~/.max/` (cog/, skills/, agents/, …) as user data — writable, user-owned. Treat everything in the Max installation tree as source code — read-only.

---

Use this skill for deep memory search and recall. Trigger if the user says "what did I say about...", "when did we discuss...", "find that conversation about...", "history of...", or asks about past information that needs multi-file search. For simple date/keyword lookups, a quick Grep suffices — this skill is for when you need to piece together a narrative from multiple entries.

## Domain

Memory recall — recursive search across all memory files, cross-referencing observations, entities, and action items.

## Memory Files

Read on activation:
- `memory/hot-memory.md` (for context on what's currently relevant)

Search across:
- All `observations.md` files (personal, work domains, cog-meta)
- All `entities.md` files
- All `action-items.md` files
- All `hot-memory.md` files
- `memory/glacier/` (via index.md for targeted retrieval)

## Process

### Pass 1: Locate

- Extract keywords from the user's query (names, topics, dates, phrases)
- `Grep path="memory/" pattern="<keyword>"` for each keyword
- Note which files matched and how many hits
- If >10 files match, narrow by domain or add query terms
- If 0 matches, try synonyms or related terms
- Check `memory/glacier/index.md` for archived data matching the query

### Pass 2: Extract

- Read the top 3-5 most relevant files (by hit density and recency)
- Extract the specific passages that match the query
- Track the timeline: when did the topic first come up? How did it evolve?

### Pass 3: Synthesize

- Combine extracted passages into a coherent answer
- Present findings chronologically with dates
- If something seems incomplete, flag it:
  > "Found references to X in observations but no entity entry — want me to create one?"

## Artifact Formats

**Search result**: `YYYY-MM-DD: <summary of what was found>`
**Memory gap**: `Gap: referenced but not in memory — <topic>`
**Timeline**: Chronological list of when a topic appeared and how it evolved

## Activation

Extract search terms from the user's query and begin Pass 1. Be thorough but concise in the synthesis — don't dump raw content.
