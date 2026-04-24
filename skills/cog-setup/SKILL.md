---
name: cog-setup
description: Cog Setup — conversational bootstrap of new domains. Use when the user says "setup cog", "add a domain", "bootstrap", "initialize memory", or when memory/domains.yml needs to be extended. Asks 3-4 discovery questions about work/hobbies/personal areas, generates domains.yml entries, creates starter files, and writes a per-domain SKILL.md.
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
- **`~/.claude/projects/*.jsonl` session transcripts** — Max stores session history in `~/.max/sessions/session-store.db`. If you need historical conversation context, use the SQL tool with `database: 'session_store'` to query turns, sessions, checkpoints, and search_index tables. See the system prompt for schema details.
- **Slash commands** (`/reflect`, `/housekeeping`, `/foresight`, `/scenario`, `/setup`, etc.) — these map to Max skills with the `cog-` prefix (`cog-reflect`, `cog-housekeeping`, etc.). When the upstream tells you to "run /X", it means: invoke or behave as the `cog-X` skill.
- **Shell commands** (`find`, `grep`, `git diff`) — use Copilot CLI's built-in `Grep`, `Glob`, and Bash tools against the absolute `~/.max/cog/memory/` paths.
- **Read/Edit/Write/Glob/Grep tools** — Copilot CLI provides these under the same verbs. Use them directly.
- **CLAUDE.md** — the equivalent is `~/.max/cog/SYSTEM.md`. Do not modify it during this skill unless explicitly instructed.
- **Git operations** — Max's working directory is not necessarily a git repo. For the cog-commit skill, operate on the user's current project directory as conveyed by the user; for everything else, skip git-specific steps.

Treat everything under `~/.max/` (cog/, skills/, agents/, …) as user data — writable, user-owned. Treat everything in the Max installation tree as source code — read-only.

---

Use this skill to bootstrap Cog for a new user or reconfigure domains. Trigger if the user says "setup", "bootstrap", "add a domain", "configure domains", or similar setup requests.

This skill is **conversational** — you ask the user about their life and work, then generate `memory/domains.yml` and everything that flows from it. No one should ever need to manually edit `domains.yml`.

## Phase 1: Discovery (Conversational)

Have a natural conversation to understand the user's domains. Ask about:

1. **Work** — "What do you do for work? Company name, role?" → becomes a `work` domain
   - Follow-up: "Do you track career growth or reviews separately?" → potential subdomain
2. **Side projects** — "Any side projects or ventures?" → each becomes a `side-project` domain
3. **Personal** — The `personal` domain is always created. Ask: "Anything specific you want to track? Health conditions, hobbies, habits, kids' school stuff?"
   - Use their answers to customize the `files` list (e.g., if they mention kids → add `school`, if health → add `health`)
4. **Anything else** — "Any other areas of your life you want Cog to help with?"

Keep it natural. Don't interrogate — 3-4 questions max. Use what they tell you to build the manifest.

### Domain Type Rules

| Type | What it means | Pipeline behavior |
|------|--------------|-------------------|
| `personal` | Personal life — always exactly one | Always in briefings |
| `work` | Day job | Included in briefings and foresight |
| `side-project` | Ventures, hobbies, side work | Included in briefings and foresight |
| `system` | Cog internals (`cog-meta`) | Never in briefings — auto-created, don't ask about |

### Building the Domain Entry

From the conversation, construct each domain:

- **id**: short slug (e.g., `canva`, `myapp`, `personal`)
- **path**: file path under `memory/` (e.g., `work/canva`, `work/myapp`, `personal`)
- **type**: one of `personal`, `work`, `side-project`, `system`
- **label**: one-line description from what the user said
- **triggers**: keywords that would route a message to this domain (infer from context — company name, project name, colleague names, etc.)
- **files**: which memory files to create. Defaults per type:
  - `personal`: `[hot-memory, action-items, entities, observations, habits, health, calendar]`
  - `work`: `[hot-memory, action-items, entities, projects, dev-log, observations]`
  - `side-project`: `[hot-memory, action-items, projects, dev-log, observations]`
  - Customize based on what user mentioned (e.g., add `school` if they have kids, add `annual-review` if they mentioned reviews)

## Phase 2: Confirm

Before writing anything, show the user a summary of what you'll create:

```
Here's what I'll set up:

Domains:
- personal — Family, health, day-to-day
- acme — Work at Acme Corp (Designer)
- myapp — Side project

This will create:
- memory/domains.yml (domain manifest)
- Memory directories + starter files for each domain
- Slash commands: /personal, /acme, /myapp
- Updated CLAUDE.md routing table

Good to go?
```

Wait for confirmation before proceeding.

## Phase 3: Generate

### 3a. Write `memory/domains.yml`

Write the complete manifest file. Always include `cog-meta` as a system domain (the user doesn't need to know about this one). Format:

```yaml
# Cog Domain Manifest — generated by /setup
# Single source of truth for all memory domains.
# To modify: run /setup again. Don't edit this file manually.

domains:
  - id: personal
    path: personal
    type: personal
    label: "<from conversation>"
    triggers: [<inferred>]
    files: [<based on type + customization>]

  - id: cog-meta
    path: cog-meta
    type: system
    label: "Cog self-knowledge, pipeline health, architecture"
    triggers: [cog, meta, evolve, pipeline, memory system, architecture]
    files: [self-observations, patterns, improvements, scenario-calibration, foresight-nudge]

  # ... work and side-project domains from conversation
```

### 3b. Create Memory Directories and Starter Files

For each domain in the manifest:
1. Create `memory/{domain.path}/` if it doesn't exist
2. For each file in the domain's `files` array, create `memory/{domain.path}/{file}.md` if it doesn't exist
3. Use these starter templates for new files:

**hot-memory.md:**
```markdown
# {Domain Label} — Hot Memory
<!-- L0: Current state and top-of-mind for {domain label} -->

<!-- Rewrite freely. Keep under 50 lines. -->
```

**observations.md:**
```markdown
# {Domain Label} — Observations
<!-- L0: Timestamped observations and events -->

<!-- Append-only. Format: - YYYY-MM-DD [tags]: observation -->
```

**action-items.md:**
```markdown
# {Domain Label} — Action Items
<!-- L0: Open and completed tasks -->

<!-- Format: - [ ] task | due:YYYY-MM-DD | pri:high/medium/low | added:YYYY-MM-DD -->
```

**entities.md:**
```markdown
# {Domain Label} — Entities
<!-- L0: People, places, and things -->

<!-- Edit in place by ### Name header. Use (since YYYY-MM) / (until YYYY-MM) for time-bound facts. -->
```

**Other files** (projects, dev-log, habits, health, calendar, etc.):
```markdown
# {Domain Label} — {File Name}
<!-- L0: {file name} data -->
```

Also handle subdomains the same way — create `memory/{subdomain.path}/` and its files.

### 3c. Generate Domain Skill Files (Max-specific)

For each new domain **skip `personal`** (pre-seeded by the daemon on first boot) and **skip `cog-meta`** (has dedicated cog-* skills). For every other domain:

1. **Find the template.** Call `list_skills` and locate the bundled `cog-personal` entry (`source: "bundled"`). `Read` `<that.directory>/SKILL.md`. Treat it as the template.
2. **Adapt for the new domain.** Rewrite `personal` / `Personal` to the new domain's id / label; update the frontmatter `name:` to `cog-<domain.id>` and `description:` to describe this domain with the triggers captured in Phase 2; adjust routing and file-edit guidance to point at `memory/<domain.path>/` instead of `memory/personal/`.
3. **Write new files to the USER-LOCAL skills root** (absolute paths, never to the bundled tree):
   - `~/.max/skills/cog-<domain.id>/SKILL.md` — the adapted content.
   - `~/.max/skills/cog-<domain.id>/_meta.json` — exactly:
     ```json
     {
       "slug": "cog-<domain.id>",
       "version": "1.0.0"
     }
     ```
4. If the target files already exist, overwrite them.
5. Repeat for subdomains (slug: `cog-<subdomain.id>`).

Then tell the user where the new skill files ended up and how to activate them:

> Created `~/.max/skills/cog-<id>/` for each new domain. They'll load on the next orchestrator session. User-local skill additions don't auto-invalidate the cached session the way bundled changes do — `systemctl --user restart max` (or `max restart` from the TUI) to pick them up now.

### 3d. Session transcripts (Max-specific)

**No action needed.** Max does not use Claude Code's `~/.claude/projects/*.jsonl` transcripts. Historical conversation context lives in `~/.max/sessions/session-store.db` and is queried directly via the SQL tool when needed. Skip this step entirely — do not write a `session_path:` field, and do not try to discover a transcript directory.

### 3e. System prompt routing (Max-specific)

**Do not edit `~/.max/cog/SYSTEM.md` from this skill.** Two reasons:

1. The user may have customized `SYSTEM.md` — it's user-owned, and auto-rewriting it risks clobbering their changes.
2. The system prompt's routing table is human-documentation, not runtime routing. Copilot SDK matches skills by each `SKILL.md`'s frontmatter `description` field (filled with trigger phrases by §3c). Once the new skill file exists under `~/.max/skills/cog-<id>/` and the daemon has restarted (so the fresh orchestrator session registers it), Max will route to it on natural-language triggers without SYSTEM.md needing to list it.

If the user wants the new domain mentioned in `~/.max/cog/SYSTEM.md` for their own reference, tell them which lines to edit and let them do it manually.

## Phase 4: Summary

Output a summary:
- Domains created
- Files and directories generated
- Next steps: "Just talk naturally — I'll route to the right domain. If you want to add more domains later, just say 'add a domain'."

## Rules

1. **Never delete** — setup only creates and updates, never removes files or directories
2. **Idempotent** — running cog-setup multiple times is safe; it skips existing memory files (observations/action-items/etc.), overwrites skill files under `~/.max/skills/cog-<id>/` from the cog-personal template (the template is the source of truth), and rewrites `~/.max/cog/memory/domains.yml`.
3. **cog-meta is automatic** — always included, never ask about it
4. **Conversational first** — the whole point is that no one edits YAML manually
5. **Re-runs are additive** — if run again with existing domains, ask "Want to add more domains or reconfigure existing ones?"
