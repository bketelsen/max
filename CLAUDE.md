# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root unless noted.

```bash
npm install                # install daemon deps (also run `npm --prefix web install` for the web UI)
npm run build              # tsc + web build (produces dist/ and web/dist/)
npm run build:daemon       # tsc only (skip web build)
npm run dev                # tsx --watch src/daemon.ts (daemon in watch mode)
npm run daemon             # one-shot daemon (no watch)
npm run tui                # run TUI client against a running daemon
npm run web:dev            # vite dev server for web/
npm run web:build          # production web bundle into web/dist/

node --test tests/<file>.test.ts                     # run a single test file
node --test tests/                                   # run all tests (node:test runner, no Jest)
node --test --test-name-pattern='<substring>' tests  # run tests matching a name
```

Launching the CLI after build: `node dist/cli.js <command>` or `npm link` + `max <command>`. `max help` lists every subcommand (`start`, `tui`, `setup`, `auth`, `service`, `housekeeping`, `reflect`, `evolve`, `update`).

There is no lint step for the daemon. The web app has `npm --prefix web run lint` (ESLint) and `npm --prefix web run typecheck`.

## Architecture

Max is a persistent daemon that wraps **`@github/copilot-sdk`** and exposes it to Telegram, a Vite/React web UI, and a local TUI. All state lives under `~/.max/`.

### Process topology

```
  Telegram ──┐         TUI ───────────┐    Web (web/dist) ──┐
             ▼                         ▼                     ▼
           src/telegram/bot.ts     src/tui/index.ts     src/api/server.ts
                       └────────── HTTP + SSE ──────────────┘
                                        │
                              src/copilot/orchestrator.ts
                                        │
                 ┌──────────────────────┼───────────────────────┐
                 ▼                      ▼                       ▼
         orchestrator session    agent sessions (@mention)   worker sessions
         (persistent `@max`)    (src/copilot/agents.ts)     (spawned per task)
```

- **`src/daemon.ts`** is the entrypoint for `max start`. It boots SQLite (`src/store/db.ts`), ensures the wiki (`src/wiki/fs.ts`), migrates legacy memory on first launch, then brings up the Copilot client, orchestrator, Express API + SSE, and Telegram bot.
- **`src/copilot/client.ts`** owns the singleton `CopilotClient`. `src/copilot/orchestrator.ts` owns the *single* persistent session whose id is stored in the `state` table under `orchestrator_session_id` — sessions are restored across restarts. All user messages are serialized through a per-session queue; do not call into the session directly.
- **`src/copilot/tools.ts`** defines the orchestrator's custom tool surface (wiki, skills, router, agent dispatch). **`src/copilot/agents.ts`** loads per-agent definitions from `agents/*.agent.md` (bundled) and `~/.max/agents/` (user), mints ephemeral sessions for `@agent` mentions, and tracks running tasks. **`src/copilot/router.ts`** + `classifier.ts` implement tiered model routing (`fast`/`standard`/`premium`) with keyword overrides; state lives in the DB.
- **`src/wiki/`** is the persistent memory substrate: `fs.ts` writes markdown pages with YAML frontmatter, `index-manager.ts` maintains a ranked TOC that gets injected into context, `context.ts` builds the per-message wiki summary, `migrate.ts` handles SQLite → wiki reorganization, `lock.ts` guards concurrent writes.
- **`src/api/server.ts`** exposes a bearer-token HTTP API + SSE stream for the TUI and web UI. Auth (`src/api/auth.ts`, `auth-routes.ts`) supports TOTP and WebAuthn/Passkey for LAN access; the API bearer token is auto-generated at `~/.max/api-token`.
- **`src/housekeeping.ts`**, **`src/reflection.ts`**, **`src/skills/evolve.ts`** are nightly jobs wired up through systemd user timers in `src/service.ts` (templates under `scripts/*.template`).
- **`web/`** is an independent Vite + React 19 + Tailwind 4 + shadcn app that ships its build into `web/dist/` and is served by the daemon's static handler.

### Key constraint: tool naming

Copilot CLI reserves many tool names (`list_agents`, `read_agent`, `write_agent`, `task`, `bash`, `grep`, `glob`, `view`, `edit`, `create`, …). A custom tool that collides fails at runtime with a "conflicts with built-in tool" error. When adding or renaming tools in `src/copilot/tools.ts`, `src/copilot/agents.ts`, or references in `src/copilot/system-message.ts`, pick a unique verb (e.g. `show_agent_roster`, `get_agent_result`). See `.github/copilot-instructions.md`.

### Runtime data layout

Everything mutable lives under `~/.max/` (constants in `src/paths.ts`):

- `max.db` — SQLite: conversation log, session state, auth creds, router state
- `wiki/pages/` — entity markdown pages (`people/`, `projects/`, `facts/`, `conversations/YYYY-MM-DD.md`, …)
- `wiki/sources/` — immutable ingested docs (originals preserved during migrations)
- `sessions/session-state/<id>/` — Copilot SDK session storage; orphans older than 7 days are pruned on daemon start
- `agents/` — user agent overrides (bundled defaults in repo `agents/` are synced in)
- `skills/` — user skills (bundled defaults in repo `skills/` are synced in)
- `.env`, `api-token`, `tui_history`, `tui-debug.log`

Config is loaded by `src/config.ts` from `~/.max/.env` (falls back to cwd `.env` for dev). `DEFAULT_MODEL` is `claude-sonnet-4.6`.

### Self-editing

`max start --self-edit` sets `MAX_SELF_EDIT=1` and unlocks tools that let Max modify its own source. Treat self-edit-only code paths carefully — they run against the repo, not `~/.max/`.

### TypeScript setup

- ESM throughout (`"type": "module"`). Source imports must use `.js` extensions even when importing `.ts` — `tsconfig.json` uses `Node16` resolution.
- `rootDir: src`, `outDir: dist`. Only `src/**` is compiled; tests use `tsx`/`node --test` against `.ts` directly.
- Node 18+ required. `node:test` is the test runner (no Jest/Mocha).
