# Changelog

All notable changes to Max are documented here.

## [Unreleased]

### Docs

- Refresh the public docs so they match the current runtime: agent-based architecture, LAN auth, web UI behavior, `max auth`, `max service` timer subcommands, and the current API surface.
- Replace the stock Vite README in `web/` with documentation for the actual Max web client.

## [1.5.0] — 2026-04-22

### Multi-agent runtime

- Keep a single persistent orchestrator session and delegate work through `delegate_to_agent`.
- Ship bundled agent definitions in `agents/*.agent.md`, sync them into `~/.max/agents/`, and preserve local edits on later syncs.
- Include bundled roles for `@max`, `@coder`, `@designer`, `@general-purpose`, `@architect`, and `@critic`.
- Track delegated work in `agent_tasks`, expose active work through `/agents`, and expose roster + recent/running task state through `/agents/status`.

### Memory — COG

- Replace `~/.max/wiki/` with **COG** at `~/.max/cog/`, including `memory/`, `sources/`, `cog-meta/`, and `glacier/`.
- Remove custom memory tools; orchestrator and agents use built-in filesystem tools directly against COG.
- Make the root system prompt user-editable at `~/.max/cog/SYSTEM.md`, seeded from `src/cog/default-system.md`.
- Bundle 11 `cog-*` skills plus additional bundled skills such as `find-skills`, `frontend-design`, and `gogcli`.
- Dispatch `cog-reflect`, `cog-housekeeping`, and `cog-foresight` from the in-daemon scheduler, and preserve `max reflect`, `max housekeeping`, and `max evolve` as HTTP-backed wrappers.
- Invalidate the persisted orchestrator session automatically when bundled skills or the bundled system prompt change.
- Archive any legacy `~/.max/wiki/` tree into `~/.max/cog/sources/wiki-archive/` on first launch.

### Web UI and auth

- Serve a Vite + React web client from the daemon, backed by the same HTTP API and SSE stream as the TUI.
- Add browser auth flows for TOTP and WebAuthn passkeys, with localhost-only setup routes and LAN cookie sessions.
- Add `max auth setup`, `max auth status`, and `max auth reset` for CLI-side auth management.
- Add `/auth/bootstrap` so localhost web clients can obtain the daemon bearer token without exposing it to LAN clients.

### Operations and API

- Support `max service install-housekeeping`, `install-reflect`, and `install-evolve` with matching uninstall/status/log subcommands.
- Expose `/history` for recent conversation restoration, `/cog/trigger` for skill dispatch, `/restart` for daemon restart, and `/send-photo` for Telegram photo delivery.
- Keep `GET /sessions` as a back-compat alias for `GET /agents`.

### Bug fixes

- Chunk long Telegram replies to stay under Telegram's message limit.
- Respect `model_override` for non-auto delegated agents.
- Avoid surfacing orchestrator timeout noise to the user and reduce duplicate timeout retry output.
- Prune orphaned session-state folders older than 7 days on startup.

### Configuration

- Document `API_BIND`, `AUTH_RP_ID`, `AUTH_RP_ORIGIN`, `AUTH_SESSION_TTL`, `COPILOT_MODEL`, and `WORKER_TIMEOUT` in `.env.example`.
- Remove obsolete wiki-era and reflect-era environment variables from the supported configuration surface.

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
