---
name: cog-foresight
description: Cog Foresight — cross-domain strategic nudges. Use when the user says "foresight", "what should I be thinking about", "connect the dots", "what am I missing", or asks for a strategic overview. Synthesizes one concrete nudge into cog-meta/foresight-nudge.md by reading briefing-bridge.md, action-item velocity, calendar, and cross-domain convergence. Invoked daily (morning) by the cog-scheduler.
---

<!--
Ported from marciopuga/cog (MIT) — see LICENSE-COG.md at the Max repo root.
Adapted for Max's GitHub Copilot SDK runtime.
-->

## Max Runtime Adapter (read first)

This skill is a port of an upstream Claude-Code-native COG skill. When the upstream prompt below refers to anything below, apply the following translation:

- **`memory/...` paths** — these are relative to `~/.max/cog/memory/`. Use absolute paths when invoking file tools: e.g. `memory/cog-meta/patterns.md` → `~/.max/cog/memory/cog-meta/patterns.md`.
- **`.claude/commands/<name>.md`** — these files live at `skills/cog-<name>/SKILL.md` in the Max installation. The generic skill template (for new domains) lives at `skills/cog-personal/SKILL.md` — copy-and-edit that.
- **`~/.claude/projects/*.jsonl` session transcripts** — Max does NOT have these. Instead, read `~/.max/cog/memory/cog-meta/recent-conversations.md`. That file is a markdown chronicle of new `conversation_log` rows, dumped by the `cog-scheduler` right before this skill is invoked. Each block is a user or Max turn with source tag, timestamp, and id. Do NOT look for `.jsonl` files. The ingestion cursor lives in `~/.max/cog/memory/cog-meta/reflect-cursor.md` and is advanced by the scheduler — do not rewrite it.
- **Slash commands** (`/reflect`, `/housekeeping`, `/foresight`, `/scenario`, `/setup`, etc.) — these map to Max skills with the `cog-` prefix (`cog-reflect`, `cog-housekeeping`, etc.). When the upstream tells you to "run /X", it means: invoke or behave as the `cog-X` skill.
- **Shell commands** (`find`, `grep`, `git diff`) — use Copilot CLI's built-in `Grep`, `Glob`, and Bash tools against the absolute `~/.max/cog/memory/` paths.
- **Read/Edit/Write/Glob/Grep tools** — Copilot CLI provides these under the same verbs. Use them directly.
- **CLAUDE.md** — the equivalent is `~/.max/cog/SYSTEM.md`. Do not modify it during this skill unless explicitly instructed.
- **Git operations** — Max's working directory is not necessarily a git repo. For the cog-commit skill, operate on the user's current project directory as conveyed by the user; for everything else, skip git-specific steps.

Treat everything under `~/.max/cog/` as user data (memory is user-owned, even though Max wrote it). Treat everything in the Max installation tree as source code — do not modify.

---

Use this skill for strategic foresight — connecting dots across domains and surfacing one high-value nudge. Trigger if the user says "foresight", "what should I be thinking about", "what am I missing", "strategic nudge", "connect the dots", or similar forward-looking synthesis requests.

**This is NOT /reflect.** Reflect = past-facing (mines interactions, fixes contradictions). Foresight = future-facing (scans broadly, projects trajectories, surfaces opportunities).

**This is NOT /evolve.** Evolve = system architecture. Foresight = life/work strategy.

## Domain

Cross-domain strategic synthesis — personal, work, projects, health, family. The value is in the connections *between* domains.

## Memory Files

Read broadly — this is a scan, not a focused lookup:

1. Read `memory/domains.yml` to discover all active domains
2. For each domain, read `hot-memory.md` and `action-items.md` (if they exist)
3. Also read:
   - `memory/hot-memory.md` (cross-domain strategic context)
   - `memory/personal/entities.md` (upcoming birthdays, relationships)
   - `memory/personal/calendar.md` (what's coming up)
   - `memory/personal/health.md` (health trajectory)
   - `memory/cog-meta/briefing-bridge.md` (housekeeping findings)
   - Recent observations across all domains (last 7 days)
   - Thread current-state sections — what narratives are actively unfolding?

## Process

### 1. Cross-Domain Convergence Scan

Look for topics, people, or themes appearing in 2+ domains simultaneously. These are convergence points — where effort in one area compounds into another.

### 2. Velocity & Stall Detection

Scan action-items across all domains. Classify each active item:
- **Accelerating** — multiple updates in the last week, clear momentum. Signal: ride the wave, don't interrupt.
- **Cruising** — steady progress, on track. Signal: nothing to flag.
- **Stalling** — no movement in 2+ weeks despite not being deferred. Signal: ask why. Blocked? Lost priority?
- **Dormant** — domain-level silence (0 observations in 4+ weeks). Signal: conscious choice or drift?

Stalls and dormant domains are high-value nudge material — they represent things the user cares about but isn't acting on.

### 3. Timing Awareness

Read calendar and entities for upcoming events in the next 2-4 weeks. Look for timing windows — things that should start NOW to be ready later.

### 4. Pattern Projection

Read patterns and recent observations. Project forward: "If this continues for 2 more weeks, what happens?"

**Scenario candidate detection**: If a pattern projection reveals a genuine fork — two meaningfully different paths with real stakes and a closing decision window — flag it as a scenario candidate below the main nudge. A valid candidate needs: a fork (2+ paths), stakes (wrong choice has real cost), and time sensitivity (window closing). Don't flag routine decisions or hypotheticals with no deadline.

### 5. Write One Strategic Nudge

Synthesize into **one nudge**. Not a list. One thing.

The nudge must:
- **Cite at least 2 source files**
- **Be something the user hasn't explicitly asked about**
- **Be actionable** — not "think about X" but "do Y because of X and Z"
- **Connect dots**

Write to `memory/cog-meta/foresight-nudge.md`:

```markdown
# Foresight Nudge
<!-- Auto-generated by strategic foresight. -->
<!-- Last updated: YYYY-MM-DD -->

## Signal
<What you noticed — the raw observation from 2+ domains>

## Insight
<Why it matters — the connection, timing, or trajectory that makes this worth flagging>

## Suggested Action
<One concrete thing to do — specific, actionable, grounded>

---
Sources: [[file1]], [[file2]], [[file3]]

## Scenario Candidate (optional)
<!-- Only include if pattern projection reveals a genuine fork worth simulating -->
Decision: <one-line framing>
Why now: <why the window is closing>
Domains: <affected domains>
```

Overwrite the file each run. One nudge per run.

## Rules

1. **Read-only** — Foresight NEVER edits memory files. Writes ONLY to `memory/cog-meta/foresight-nudge.md`. If you spot a memory error, note it in the nudge's signal section and let reflect handle it.
2. **One nudge, not a list** — force prioritization. If everything is equally important, nothing is.
3. **Evidence-based** — every nudge cites at least 2 source files. No vibes.
4. **Non-obvious** — the nudge should surprise. If the user already knows and is acting on it, pick something else.
5. **Forward-looking** — avoid rehashing yesterday. Project into next week, next month.
6. **Cross-domain preferred** — nudges that connect personal + work are higher value than single-domain insights.

## Anti-Patterns

- Don't repeat what briefing-bridge already says (stale items, birthday prep) — that's housekeeping's job
- Don't recommend "reflect on X" — be specific about what to DO
- Don't flag things the user has explicitly deferred — respect the deferral
- Don't flag things that are cruising — focus on convergences, stalls, and timing windows
- Don't write a mini-briefing — one insight, one action

## Activation

Read broadly across all domains. Find the one thing worth saying.
