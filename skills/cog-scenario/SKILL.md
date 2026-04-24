---
name: cog-scenario
description: Cog Scenario — decision simulation and branch modeling. Use when the user says "scenario", "what if", "simulate", "model the options", "walk through a decision", or asks to explore consequences of a choice. Generates a decision file under cog-meta/scenarios/ with paths, timelines, assumptions, risks, canary signals, and calibrated confidence.
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

Use this skill for scenario simulation — modeling decision branches with timelines, dependencies, and contingencies grounded in real memory data. Trigger if the user says "scenario", "what if", "model this", "simulate", "play out", "what happens if", or similar branching/decision-modeling requests. Also triggered when foresight flags a scenario candidate.

**This is NOT /foresight.** Foresight = scan broadly, write one nudge. Scenario = take a specific decision point, branch it into 2-3 paths, map dependencies and timelines for each. **Foresight finds the question. Scenario models the answers.**

**This is NOT /reflect.** Reflect = past-facing, mines interactions, improves memory. Scenario = future-facing, models possible futures from a decision point. Reflect checks old scenarios against reality (the feedback loop), but scenario creates them.

## Domain

Cross-domain decision modeling — personal, work, projects, health, family. Scenarios are most valuable when a decision in one domain has cascading effects across others.

## Memory Files

Read based on scenario topic — this is focused, not a broad scan:
- `memory/hot-memory.md` (cross-domain strategic context)
- `memory/personal/calendar.md` (upcoming timeline for overlay)
- `memory/personal/action-items.md` (existing commitments, constraints)
- Work domain action-items (read `memory/domains.yml` for active work domains)
- Relevant domain hot-memory and entity files based on the scenario topic
- `memory/cog-meta/scenarios/` (existing scenarios — check for duplicates or related active scenarios)
- `memory/cog-meta/scenario-calibration.md` (past accuracy — calibrate confidence accordingly)

## Process

### 1. Decision Point Identification

From user input or foresight seed, identify the specific decision point. A valid scenario requires:
- A **fork** — at least 2 meaningfully different paths forward
- **Stakes** — the outcome matters enough that choosing wrong has real cost (time, money, relationships, health)
- **Uncertainty** — the right choice isn't obvious from current information
- **Time sensitivity** — the decision window is closing or the consequences unfold on a timeline

If the input doesn't meet these criteria, say so and suggest what would make it scenario-worthy. Don't force-fit.

Format the decision point:
```
Decision: <one-line framing>
Context: <why this matters now — cite memory files>
Window: <when must this be decided by>
Domains affected: <which life/work domains>
```

### 2. Dependency Mapping

Read across memory files to identify what this decision depends on and what depends on it.

**Upstream dependencies** (things that constrain the decision):
- Calendar events, deadlines, commitments from action-items
- Other people's states/decisions from entities
- Health, financial, or logistical constraints
- Active scenarios that overlap

**Downstream consequences** (things that change based on which path is chosen):
- Action items that would need to change
- Calendar events that would need to move
- People who would be affected
- Other decisions that cascade from this one

Every dependency must cite its source file: `[[personal/calendar]]`, `[[work/acme/action-items]]`, etc.

### 3. Branch Generation

Generate 2-3 branches. Not more — forced prioritization.

For each branch:

```
### Branch N: <name>

**Path**: <what happens, step by step>
**Timeline**: <when each step occurs, mapped to real calendar>
**Assumptions**: <what must be true for this path to work>
**Dependencies**: <what else changes if this path is taken>
**Risk**: <what could go wrong, and what would you see first — the canary signal>
**Confidence**: <how likely is this path to play out as described — calibrated against past scenario accuracy>
```

Branch quality rules:
- Each branch must be **genuinely different** — not "do it" vs "do it but slightly differently"
- Include at least one branch the user probably isn't considering (the non-obvious path)
- Every claim in a branch must trace to a memory file or be explicitly marked as an assumption

### 4. Timeline Overlay

Map each branch's key events against the actual calendar. Cross-reference `calendar.md` for recurring routines.

Output a simple timeline per branch:
```
Branch 1 Timeline:
- Week of Mar 17: <action>
- Week of Mar 24: <action> (note: conflict with X)
- Week of Apr 1: <action>
...
```

The overlay is what makes scenarios useful — it shows where branches collide with reality.

### 5. Contingency Mapping

For each branch, identify the **canary signal** — the earliest observable indicator that this branch is going off-track.

```
If [assumption] breaks → watch for [signal] → pivot to [contingency]
```

This turns the scenario from a static prediction into a monitoring framework.

### 6. Write Scenario File

Write to `memory/cog-meta/scenarios/{slug}.md`:

```yaml
---
type: scenario
domain: <primary domain(s)>
created: YYYY-MM-DD
status: active
check-by: YYYY-MM-DD
resolution-by: YYYY-MM-DD
decision: <one-line>
related-threads: [thread1, thread2]
source: user|foresight
---
```

Body format:
```markdown
# Scenario: <decision>
<!-- Auto-generated by /scenario. Checked by /reflect. -->

## Decision Point
<from step 1>

## Dependencies
### Upstream
<constraints — each with [[source]] link>

### Downstream
<consequences — each with [[source]] link>

## Branches

### Branch 1: <name>
<from step 3>

### Branch 2: <name>
<from step 3>

### Branch 3: <name> (optional)
<from step 3>

## Timeline Overlay
<from step 4>

## Contingency Map
<from step 5>

## Retrospective
<!-- Added by /reflect when status changes to resolved -->
```

## Rules

1. **Read-only except for output** — Scenario NEVER edits existing memory files. Writes ONLY to `memory/cog-meta/scenarios/{slug}.md`. If you spot a memory error, note it in the dependencies section and route to reflect.
2. **2-3 branches, not more** — force prioritization. If you can't distinguish 2 branches, it's not a scenario.
3. **Evidence-based** — every dependency and assumption cites a source file. No hunches.
4. **Calendar-grounded** — every branch must overlay against the real calendar. No timelines in a vacuum.
5. **Confidence-calibrated** — read `scenario-calibration.md` before assigning confidence. If past scenarios have been overconfident, adjust.
6. **One scenario per decision** — don't combine multiple decisions. If they're linked, note the dependency and create separate scenarios.

## Anti-Patterns

- Don't scenario obvious decisions — if one path is clearly better, just say so
- Don't scenario things already decided — check action-items for existing commitments
- Don't produce "analysis paralysis" — the goal is clarity, not exhaustive enumeration
- Don't scenario recurring/routine decisions — this is for inflection points, not daily choices
- Don't ignore the non-obvious path — if all branches are variations of what the user already thinks, you're not adding value
- Don't invent facts — if you don't have data for a dependency, mark it as an assumption

## Trigger Threshold

A scenario is worth running when:
1. **Foresight flags it** — foresight's pattern projection identified a fork with stakes
2. **User explicitly asks** — `/scenario what if...`
3. **Action item conflict** — two critical/high-priority action items have incompatible timelines
4. **Calendar crunch** — upcoming 2-week window has more commitments than capacity
5. **Cross-domain cascade** — a decision in one domain visibly affects 2+ others

NOT worth running for: hypotheticals with no deadline, decisions where all paths lead to the same outcome, things already decided.

## Activation

Read scenario-calibration.md first (if it exists) for past accuracy. Then read the relevant memory files for the scenario topic. Model the futures. Be honest about uncertainty.
