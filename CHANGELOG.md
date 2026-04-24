# Changelog

All notable changes to Max are documented here.

## [Unreleased]

### Memory — COG port (replaces the wiki system)

- Replace `~/.max/wiki/` with **COG** ([marciopuga/cog](https://github.com/marciopuga/cog), MIT — see `LICENSE-COG.md`) adapted for the Copilot SDK. Memory now lives at `~/.max/cog/`: `memory/{hot-memory,link-index}.md`, per-domain directories (`personal/`, `work/<job>/`), `memory/cog-meta/` for self-observations and patterns, `memory/glacier/` for archives, and `sources/` for immutable inputs.
- **Skills-only invocation, no custom memory tools.** The orchestrator and agents read and write memory using Copilot CLI's built-in `Read`/`Write`/`Edit`/`Glob`/`Grep`. `remember`, `recall`, `forget`, `wiki_search`, `wiki_read`, `wiki_update`, `wiki_ingest`, `wiki_lint`, `wiki_rebuild_index` are removed from `src/copilot/tools.ts`.
- **System prompt is now user-editable** at `~/.max/cog/SYSTEM.md` (bundled default shipped at `src/cog/default-system.md`, copied into place on first run). Persona, domain routing table, SSOT rule, L0/L1/L2 retrieval protocol, file edit patterns, and the glacier schema live there — all editable without touching source.
- **11 bundled pipeline skills** at `skills/cog-*/` — `cog-reflect` (observation clustering, pattern distillation, thread detection), `cog-housekeeping` (archival, link-index audit, hot-memory pruning), `cog-foresight` (daily strategic nudges), `cog-evolve` (memory-architecture audit), `cog-scenario` (decision branch modeling), `cog-history` (deep recall), `cog-setup` (conversational domain bootstrap), plus `cog-personal`, `cog-explainer`, `cog-humanizer`, `cog-commit`. Each carries a Max runtime adapter header translating upstream Claude-Code references to the Copilot SDK runtime.
- **In-daemon scheduler** (`src/cog/scheduler.ts`) dispatches `cog-reflect` nightly (>20 h since last), `cog-housekeeping` weekly, `cog-foresight` daily (morning). `cog-reflect` now queries `sessions/session-store.db` directly via the SQL tool, owns its `cog-meta/reflect-cursor.md` turn cursor, and uses a runtime lock to prevent duplicate runs.
- **cog-reflect refactor**: Removed intermediate `recent-conversations.md` file; cog-reflect now queries `session-store.db` directly via SQL tool for cleaner, more accurate conversation analysis.
- **CLI + systemd compatibility preserved.** `max reflect`, `max housekeeping`, `max evolve` still exist — they are now thin wrappers over `POST /cog/trigger` on the running daemon. The systemd timers from `max service install-*` continue to fire these commands unchanged. `--dry-run` and `--hours N` flags are accepted for back-compat but warn and are ignored (skill-driven execution decides what to change).
- **Session invalidation when bundled content changes** (`src/cog/fingerprint.ts`). Copilot SDK bakes the skill list into a session at create time; `resumeSession` does not re-discover skills. On each daemon start the bundled skills' + SYSTEM.md's SHA-256 is compared to the last stored fingerprint; on mismatch the saved `orchestrator_session_id` is deleted so the next boot creates a fresh session that picks up the current skill list.
- **Admin endpoint** `POST /cog/trigger { skill: reflect | housekeeping | foresight | evolve, force?: boolean }` — bearer-token-authed. Default `force: true`. Used by the CLI wrappers; also usable directly via curl for ad-hoc dispatch.
- **Wiki archive migration.** On first boot, any legacy `~/.max/wiki/` is moved verbatim to `~/.max/cog/sources/wiki-archive/` via a single atomic rename (idempotent, gated by the `cog_wiki_archived` state key). No re-classification; `cog-reflect` surfaces its contents organically over time.
- **Removed**: `src/wiki/*`, `src/copilot/episode-writer.ts`, `skills/evolve/`, `skills/housekeeping/` (the bare pre-COG versions — `cog-evolve` / `cog-housekeeping` supersede them).
- **Updated** `/memory` HTTP endpoint and Telegram `/memory` command to return/display COG hot memory, universal patterns, and the domain list from `domains.yml` (previously returned the wiki index).

### Configuration

- Dropped dead env vars: `REFLECT_ENABLED`, `REFLECT_NOTIFY_TELEGRAM`, `REFLECT_NOTIFY_ON_ERROR_ONLY`, `REFLECT_HOURS`, `REFLECT_PATTERN_THRESHOLD`. COG cadence and thresholds are module constants in `src/cog/scheduler.ts`.
- `.env.example` rewritten — documents `API_BIND` (0.0.0.0 for LAN exposure) and the `AUTH_*` variables that accompany it. Memory section now describes COG instead of wiki.

## [1.5.0] — 2026-04-22

### Multi-agent system
- Replace ephemeral workers with a persistent multi-agent architecture — Max now delegates to specialist agents (coder, designer, general-purpose) that run in their own Copilot sessions.
- Bundled agent definitions ship with Max and auto-sync on startup; user customizations are preserved.
- `delegate_to_agent` now includes a summary field for compact `/workers` display.
- Show agent name and model in `/workers` output.
- All agents get full tool access by default.

### Wiki memory v2
- Complete rewrite of the wiki memory system for reliability and correctness.
- Ranked index-first context injection — every message carries a relevance + recency-scored table of contents instead of force-feeding stale page bodies.
- Episodic memory — after extended conversations, a background writer summarizes the session into daily conversation pages with cross-references.
- Wiki reorganization — flat ingested dumps are automatically split into per-entity pages (`people/`, `projects/`, etc.).
- Richer wiki index with tags, dates, and improved search ranking.
- `remember`, `recall`, `forget` redesigned as wiki-only tools.
- SQLite memory legacy fully removed — automatic migration on upgrade.

### Skills
- Bundle the `frontend-design` skill with an updated designer agent prompt.

### Bug fixes
- Fix Telegram errors on long messages (chunk messages that exceed Telegram's limit).
- Fix `model_override` always being ignored for non-auto agents.
- Fix orchestrator timeout: never surface timeout errors to user.
- Fix duplicate messages caused by timeout retries.
- Prune orphaned session folders at startup (older than 7 days).

### Under the hood
- Update `@github/copilot-sdk` to 0.2.2.
- Updated docs, README, and system message for the new memory and agent systems.

---

## [1.4.0] — 2026-04-05

### Wiki-based memory
- Replace flat SQLite memory with an LLM-maintained wiki knowledge base at `~/.max/wiki/`.
- Per-entity markdown pages with YAML frontmatter, tags, and `[[wiki links]]`.
- Tools: `remember`, `recall`, `wiki_search`, `wiki_read`, `wiki_update`, `wiki_ingest`, `wiki_lint`, `forget`.
- Automatic migration from SQLite memories to wiki pages on first launch.
- Updated landing page and docs with wiki memory feature.

---

## [1.3.0] — 2026-04-02

### Telegram enhancements
- Handle Telegram reply context and incoming photos.

### Memory foundations
- Add memory system foundations (pre-wiki, SQLite-based).

---

## [1.2.2] — 2026-03-17

### Auto model routing fixes
- Disable auto model routing by default (opt-in with `/auto`).
- Fix auto-router cooldown blocking first model switch.
- Add `/auto` command to Telegram bot.
- Show current model when toggling auto mode off.
- Hide model name in Telegram when auto-routing is off.

---

## [1.2.1] — 2026-03-17

### Hotfix
- Pin `@github/copilot-sdk` to 0.1.30 to fix ESM import crash.

---

## [1.2.0] — 2026-03-17

### Smart model router
- Add automatic model routing — Max classifies messages by complexity and picks the cheapest model that can handle it (GPT-4.1 for trivial, GPT-5.1 for moderate, Claude Sonnet for complex).
- `/auto` toggle in both TUI and Telegram.
- Model indicator shown on responses when auto mode is active.

### TUI improvements
- ANSI-aware word wrapping for TUI responses.
- Hide model label in TUI when auto mode is off.

### Docs
- Add auto mode documentation and landing page feature section.

---

## [1.1.0] — 2026-03-06

### Production hardening
- Production readiness P0: OS detection, API robustness, model validation.
- Security, reliability, and code quality audit.
- Validate configured model at startup with fallback to `claude-sonnet-4.6`.
- Handle invalid Telegram token gracefully (no unhandled rejection).
- Improve Telegram auth error messages with specific guidance.
- Increase worker timeout to 10 minutes (configurable via `WORKER_TIMEOUT`).
- Fix: insert line breaks between text blocks separated by tool calls.

### Skills
- Better skills interface with table display, uninstall, and security audits.
- Replace global skill install with local-only flow via skills.sh.
- Simplify `find-skills` SKILL.md for reliable skill installation.
- Add Slack skill for secure read/write access.

### Setup
- Fetch models from Copilot SDK during `max setup` instead of hardcoded list.

### TUI
- Animated thinking indicator.
- Fix thinking line streaming UX.
- Restore blank line between YOU/MAX and add spacing between interactions.

---

## [1.0.1] — 2026-03-04

### Fixes
- Add repository URL and LICENSE to package.
- Fix `/copy` command — store last response, use ESM import.
- Add `--self-edit` flag to prevent Max from modifying his own code by default.
- Require user permission before installing skills; flag security risks.
- Fix gogcli install/auth instructions and Copilot CLI package name.
- Fix install script: redirect stdin from `/dev/tty` for setup.
- Fix TUI multiline input wrapping into YOU label.
- Add self-update capability (`max update`).

---

## [1.0.0] — 2026-03-01

### Initial release
- **Orchestrator**: persistent Copilot SDK session that receives messages and delegates coding tasks to worker sessions.
- **Telegram bot**: authenticated remote access from your phone (locked to your user ID).
- **TUI**: local terminal client with streaming, colors, markdown rendering, history, and banner.
- **Skill system**: modular skills with `learn_skill`, MCP support, and path-safe skill creation. Community skill discovery via [skills.sh](https://skills.sh).
- **Worker sessions**: async non-blocking Copilot CLI sessions in any directory with proactive notifications.
- **Memory**: conversation memory with per-message concurrent sessions.
- **Google integration**: Gmail, Calendar, Drive via gogcli setup in `max setup`.
- **Infinite sessions**: SDK-powered context compaction for long-running conversations.
- **Self-awareness**: Max knows his own architecture, channels, and identity.
- **Docs site**: landing page and documentation at max.dev.
- **Robust recovery**: auto-reconnect on SDK timeout, graceful daemon shutdown, session persistence.
