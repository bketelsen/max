---
name: cog-commit
description: Cog Commit — git commit with memory integration. Internal skill (not typically user-invoked). Use when working on a git repo and the user asks to commit changes — it writes a commit message that references relevant memory context.
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

Use this skill when the user wants to commit changes to git. Trigger if the user says "commit", "save changes", "commit this", or asks to create a git commit. Examples: "commit", "commit and push", "save my changes".

## Process

1. **Assess the working tree** — Run `git status` (never use `-uall`) and `git diff --staged` and `git diff` to understand what changed.

2. **Guard rails** — Before staging:
   - Never commit files that contain secrets (`.env`, credentials, tokens, keys). Warn if any are present.
   - Never commit build artifacts (`dist/`, `*.tsbuildinfo`).
   - Never commit `node_modules/`.
   - If there are no changes to commit, say so and stop.

3. **Stage selectively** — Stage files by name. Prefer `git add <file>...` over `git add -A` or `git add .` to avoid accidentally including sensitive or unrelated files. Group related changes — if unrelated changes exist, ask whether to commit everything together or separately.

4. **Write the commit message** — Use Conventional Commits format:
   - `feat:` new feature
   - `fix:` bug fix
   - `refactor:` code restructuring without behavior change
   - `chore:` maintenance, dependencies, config
   - `docs:` documentation only
   - `style:` formatting, whitespace
   - `test:` adding or updating tests
   - Scope is optional: `feat(whatsapp): add voice note transcription`
   - Subject line: imperative mood, lowercase, no period, under 72 chars
   - Body (if needed): blank line after subject, wrap at 72 chars, explain *why* not *what*
   - Always end with: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

5. **Commit** — Use a HEREDOC for the message to preserve formatting:
   ```
   git commit -m "$(cat <<'EOF'
   type(scope): subject line

   Optional body explaining why.

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

6. **Verify** — Run `git status` after committing to confirm success. Show the resulting `git log --oneline -1`.

## Rules

- Never push unless `$ARGUMENTS` contains "and push" or "push".
- Never amend unless `$ARGUMENTS` contains "amend".
- Never skip hooks (no `--no-verify`).
- Never force push.
- If a pre-commit hook fails, fix the issue, re-stage, and create a **new** commit (do not amend).
- If `$ARGUMENTS` contains a message hint, use it to inform the commit message but still follow conventional format.

## Arguments

`$ARGUMENTS` — Optional. May contain:
- A message hint (e.g., `/commit add voice transcription support`)
- "and push" to push after committing
- "amend" to amend the previous commit instead of creating a new one
- "all" to stage all changes without asking
