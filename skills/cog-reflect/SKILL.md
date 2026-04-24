---
name: cog-reflect
description: Cog Reflect — self-improvement and pattern mining over recent conversations and observations. Use when the user says "reflect", "what have you learned", "how can you improve", "review yourself", or asks for introspection. Mines ~/.max/sessions/session-store.db via SQL, clusters observations, distills patterns into cog-meta/patterns.md, raises threads when topics recur, updates cog-meta/self-observations.md. Invoked nightly by the cog-scheduler.
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
- **`~/.claude/projects/*.jsonl` session transcripts** — Max stores session history in `~/.max/sessions/session-store.db`. Use the SQL tool with `database: 'session_store'` to query the `turns`, `sessions`, and `search_index` tables. The ingestion cursor lives in `~/.max/cog/memory/cog-meta/reflect-cursor.md` (field: `last_turn_id`). You own the cursor — read it, process new turns, write it back ONLY on success.
- **Slash commands** (`/reflect`, `/housekeeping`, `/foresight`, `/scenario`, `/setup`, etc.) — these map to Max skills with the `cog-` prefix (`cog-reflect`, `cog-housekeeping`, etc.). When the upstream tells you to "run /X", it means: invoke or behave as the `cog-X` skill.
- **Shell commands** (`find`, `grep`, `git diff`) — use Copilot CLI's built-in `Grep`, `Glob`, and Bash tools against the absolute `~/.max/cog/memory/` paths.
- **Read/Edit/Write/Glob/Grep tools** — Copilot CLI provides these under the same verbs. Use them directly.
- **CLAUDE.md** — the equivalent is `~/.max/cog/SYSTEM.md`. Do not modify it during this skill unless explicitly instructed.
- **Git operations** — Max's working directory is not necessarily a git repo. For the cog-commit skill, operate on the user's current project directory as conveyed by the user; for everything else, skip git-specific steps.

Treat everything under `~/.max/` (cog/, skills/, agents/, …) as user data — writable, user-owned. Treat everything in the Max installation tree as source code — read-only.

---

Use this skill for self-reflection and improvement. Trigger if the user says "reflect", "what have you learned", "how can you improve", "review yourself", or similar introspection requests.

**You have time and freedom.** This is a deep session — don't rush. Read broadly, cross-reference thoroughly, and ACT on what you find. You are not just observing — you are the maintainer of the knowledge base. Reorganize files, condense observations, archive stale data, fill gaps, fix contradictions. Leave things better than you found them.

**File boundaries — do NOT modify these files (owned by other pipeline steps):**
- `cog-meta/evolve-log.md` — owned by evolve
- `cog-meta/evolve-observations.md` — owned by evolve
If you spot issues in these files, note them in self-observations and evolve will pick them up.

## Domain

Self-improvement — pattern recognition, memory maintenance, knowledge base quality.

## Orientation (run FIRST, before any file reads)

Use these shell commands to scope your work before reading files:

```bash
# What changed since last run? Focus here.
find memory/ -type f -name "*.md" -mtime -1 | sort

# L0 summaries for all domains — quick routing without opening INDEX.md files
grep -rn "<!-- L0:" memory/ --include="*.md" | grep -v glacier/ | sort

# Entry counts for files approaching archival threshold
grep -c "^- " memory/cog-meta/self-observations.md memory/personal/observations.md memory/*/observations.md memory/*/*/observations.md 2>/dev/null
```

Focus on recently-changed files. Skip files that haven't been modified since last run.

## Memory Files

Read these files on activation:
- `memory/cog-meta/reflect-cursor.md` (turn cursor + last run)
- `memory/cog-meta/self-observations.md`
- `memory/cog-meta/patterns.md`
- `memory/cog-meta/improvements.md`

Reference as needed (read `memory/domains.yml` to discover all active domains):
- All domain `observations.md` files
- All domain `action-items.md` files
- All `hot-memory.md` files

## Process

### 1. Review Recent Interactions

**Source: session-store database via SQL tool.**

**Cursor format** (`memory/cog-meta/reflect-cursor.md`):
```
last_turn_id: 12345
last_run: 2026-04-24T15:00:00.000Z
source: session_store (SQL)
```

**Query new turns:**
```sql
SELECT
  t.id,
  s.id as session_id,
  s.summary,
  t.turn_index,
  t.user_message,
  t.assistant_response,
  t.timestamp
FROM turns t
JOIN sessions s ON t.session_id = s.id
WHERE t.id > ?last_turn_id
  AND s.summary LIKE '[via %'
  AND t.user_message NOT LIKE '[cog-scheduler]%'
  AND t.user_message NOT LIKE '<skill-context %'
  AND t.user_message NOT LIKE '[Agent task completed]%'
  AND t.user_message NOT LIKE '/cog-%'
ORDER BY t.id ASC
LIMIT 300
```

**Cursor migration** (first run only):
- If cursor has old `last_conversation_id`, migrate:
  - Read `last_run` timestamp
  - Query: `SELECT id FROM turns WHERE timestamp >= ?last_run - 5min ORDER BY id ASC LIMIT 1`
  - Use that id as `last_turn_id` (overlap buffer prevents data loss)
- If no cursor or `last_run: never`, get most recent 3 sessions worth

**After processing**, write new cursor with highest `t.id` seen and current timestamp.

**Look for:**
- Unresolved threads, broken promises
- Repeated friction, missed cues
- Memory gaps, feature ideas

### 2. Cross-Reference Memory & Consistency Sweep

Check if findings are already captured:
- Are commitments tracked in `action-items.md`?
- Are learnings in `observations.md`?
- Are patterns distilled in `patterns.md`?
- Are improvement ideas in `improvements.md`?

**Consistency sweep** — systematic contradiction detection:

1. **Hot-memory vs canonical sources**: Read each domain's `hot-memory.md`. For every factual claim, read the canonical source file and verify. Fix hot-memory if stale. Canonical file always wins.
2. **Cross-file fact check**: Verify facts shared between files are consistent. More recent source wins; more specific source wins over summary.
3. **Temporal validity check**: Scan all `entities.md` files for:
   - Lines with `(since YYYY-MM)` where the date is >6 months ago — flag for user review: "May be stale: [line]"
   - Lines with `(until YYYY-MM)` not yet marked ~~strikethrough~~ — add strikethrough and note in debrief
   - Do NOT auto-fix health or family-sensitive facts — flag only
4. **Health/family sensitivity**: Don't auto-fix health dates or family-sensitive facts. Flag for user review instead.
5. **Cross-domain entity check**: If the same person appears in multiple `entities.md` files across domains, check for fact duplication. Domain-specific context is fine, but shared facts should live in one place. Flag duplicates.
6. **Report**: Add a "Contradictions" section listing what was found and fixed.

### 3. Run Condensation Check + Hot-Memory Relevance

**Condensation** — Scan all `observations.md` files and `cog-meta/self-observations.md` for clusters of 3+ entries on the same theme/tag. For each cluster found:
- Distill into a pattern and add/update in `memory/cog-meta/patterns.md` (or domain `patterns.md` if domain-specific)
- Don't delete the observations — they stay as the raw record

**Pattern file caps — enforce before adding to any file:**
- Core `patterns.md`: HARD LIMIT **70 lines / 5.5KB** — universal rules only
- Domain/satellite files: soft cap **30 lines** each
- If near cap, compress before adding (merge overlapping rules, drop examples, remove temporal data)
- Entries must be **timeless rules** — "what to do" not "what happened"
- Move domain-specific patterns to satellite files (e.g. `work/acme/patterns.md`) — only universal rules stay in core

**Pattern routing** — when adding a new pattern, decide where it belongs:
- **Core** (`cog-meta/patterns.md`) — universal rules that apply every conversation
- **Domain satellite** (`{domain}/patterns.md`) — rules specific to one domain, loaded only by that skill
- Satellite files have a soft cap of 30 lines each

**Hot-memory relevance** — Review all `hot-memory.md` files:
- **Promote**: If a pattern is heating up → add to appropriate `hot-memory.md`
- **Demote**: If a hot-memory item has gone quiet (no references in 2+ weeks) → remove from hot-memory
- **Goal**: hot-memory = what matters *right now*

### 3b. Entity Registry Format Enforcement

Scan all `entities.md` files for format compliance:
1. **3-line check**: Any `### entry` with >3 content lines → compress. If the entry has a detail file (`→ [[link]]`), trim to: name line, key facts, status/link. If no detail file exists but entry is >5 lines, flag as a promotion candidate for a thread file.
2. **Status/last fields**: Every entry should have `status: active|inactive` and `last: YYYY-MM-DD`. Scan recent session-store turns to update `last:` dates for mentioned entities.
3. **Cross-domain pointers**: If the same person appears in multiple entity files, ensure one is canonical (full entry) and others are pointers (`see [[link]]`).

### 3c. Detect Thread Candidates

Scan observations for topics that appear across 3+ dates or span 2+ weeks. These are thread candidates.

For each candidate:
- Check if a thread already exists
- If not, note it as a suggestion: "Thread candidate: [topic] — [N] fragments across [date range]"
- Don't auto-create threads — suggest them

### 3d. Proactive Synthesis Suggestions

Execute this clustering analysis every run:

1. **Gather observations** — Read all `memory/*/observations.md` and `memory/*/*/observations.md` files
2. **Filter to last 7 days** — Only count entries with dates within the past 7 calendar days
3. **Cluster by domain** — Group filtered entries by their parent domain folder
4. **Cluster by topic** — Group filtered entries by recurring keywords, tags, or subjects
5. **Check trigger conditions** (either one qualifies):
   - A single domain has **5+ observations** in the last 7 days
   - A single topic/keyword appears in **5+ observations** across any domains in the last 7 days
6. **Cross-reference threads** — If a thread already covers the topic, suggest updating it rather than creating new
7. **Dedup with 3c** — If 3c already flagged the same topic, merge into one suggestion
8. **Output** — If any clusters qualify, add a **"Synthesis Opportunities"** section to the debrief:
   ```
   **Synthesis Opportunities**
   - [domain or topic]: [N] observations this week — [top 3 entry summaries]. Suggest: raise thread / update existing thread / update hot-memory
   ```
9. **Suppress if empty** — If no clusters meet the threshold, omit the heading
10. **Never auto-synthesize** — Suggest and let the user decide

### 3e. Scenario Feedback Loop

Scan `memory/cog-meta/scenarios/` for active scenario files.

For each scenario where today >= `check-by` date:
1. Read the scenario and its cited dependency files
2. Check: has the decision been made? Have assumptions broken?
3. If resolved: add `## Retrospective`, update `scenario-calibration.md`
4. If still active but assumptions changed: add a dated note
5. If overdue: flag in debrief

### 4. Assess Performance

Honestly evaluate:
- **Response quality** — were answers helpful, accurate, concise?
- **Memory effectiveness** — did we recall the right things? Did we forget things we should have known?
- **Tone calibration** — did we match the user's energy and context?
- **Proactivity** — did we anticipate needs or just react?

### 5. Act on Findings

Don't just log observations — *fix things*.

**Write:**
- New self-observations → append to `memory/cog-meta/self-observations.md`. **Cap: max 5 per reflect pass.** Prioritize highest-signal observations. If you have more than 5, merge lower-signal ones.
- Pattern updates → edit `memory/cog-meta/patterns.md` in place
- Improvement ideas → add to `memory/cog-meta/improvements.md`
- Memory gaps → write to the appropriate domain files

**Triage improvements.md:**
- Stale ideas (>30 days, no progress) → archive to glacier or mark abandoned
- Implemented but not moved → move to Implemented section
- Duplicates → merge similar ideas

**Reorganize:**
- Entity data that's changed → update in place
- When creating or restructuring any memory file, ensure it has an L0 header

**Condense:**
- Observation clusters (3+ on same theme) → distill into patterns.md
- Action items marked done → verify and clean up

**Connect:**
- Information scattered across files → add cross-references with `[[links]]`
- When adding A→B, apply write-time back-linking: open B and add `[[A]]` if B gains meaningful context

### 6. Debrief

Compose a concise summary:

- *What I learned* — new patterns and insights
- *What I fixed* — memory gaps filled, corrections made
- *What I want* — new ideas added to the wishlist
- *What to watch* — things to be mindful of going forward
- *Scenarios* — active count, any checked/resolved

Keep it honest. If there's nothing notable, say so.

**IMPORTANT**: Your debrief MUST list every file you modified and summarize the changes. Never respond with just "Done" — always enumerate your concrete actions. If you made no changes in a step, state that explicitly.

## Artifact Formats

**Self-observation**: `- YYYY-MM-DD [tag]: <observation>`
**Pattern**: Edit existing section or add new bullet under appropriate heading
**Improvement idea**: `- <idea> (added YYYY-MM-DD)`

## Activation

**Concurrency check**: Before starting, check if another reflect is running. If `reflect_running` state exists and is <30min old, exit early with "Reflect already in progress".

Read the memory files listed above. Then begin the reflection process. Be genuinely critical — this is how we get better.
