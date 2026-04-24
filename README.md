# Max

Persistent AI orchestrator for developers, powered by the GitHub Copilot SDK. Max runs as a daemon on your machine and exposes the same brain through a terminal UI, a web UI, and an optional Telegram bot.

## Highlights

- **Always on** — `max start` boots one long-lived orchestrator session instead of a throwaway chat tab.
- **Multi-agent delegation** — Max can delegate work to bundled specialist agents such as `@coder`, `@designer`, `@general-purpose`, `@architect`, and `@critic`.
- **COG memory** — persistent filesystem memory lives under `~/.max/cog/`, with hot memory, domain files, and glacier archives.
- **Auto model routing** — optional fast / standard / premium routing with keyword overrides.
- **Web + terminal + Telegram** — connect locally with `max tui`, open the web app at `http://127.0.0.1:7777`, or use Telegram if configured.
- **LAN auth** — when you bind Max beyond localhost, browser access can be protected with TOTP and passkeys.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/burkeholland/max/main/install.sh | bash
```

Or install from npm:

```bash
npm install -g heymax
```

## Quick start

1. Authenticate Copilot CLI:

   ```bash
   copilot login
   ```

2. Run interactive setup:

   ```bash
   max setup
   ```

3. Start the daemon:

   ```bash
   max start
   ```

4. Connect with one of the clients:

   ```bash
   max tui
   # or open http://127.0.0.1:7777
   ```

Telegram is optional. The web UI is always served by the daemon.

## CLI commands

| Command | Description |
| --- | --- |
| `max start [--self-edit]` | Start the daemon |
| `max tui` | Connect to the daemon from the terminal |
| `max setup` | Interactive first-run setup |
| `max auth <setup\|status\|reset>` | Manage LAN authentication |
| `max service <subcommand>` | Manage the Linux systemd service and timers |
| `max housekeeping [--dry-run]` | Dispatch `cog-housekeeping` through the daemon |
| `max reflect [--dry-run] [--hours N]` | Dispatch `cog-reflect` through the daemon |
| `max evolve [--dry-run]` | Dispatch `cog-evolve` through the daemon |
| `max update` | Check npm for a newer `heymax` release and install it |
| `max help` | Show CLI help |

`max housekeeping`, `max reflect`, and `max evolve` are compatibility wrappers over `POST /cog/trigger`. The `--dry-run` and `--hours` flags are accepted for compatibility, but the running daemon still dispatches the real skill and lets the skill decide what to change.

### `max service` subcommands

| Subcommand | Description |
| --- | --- |
| `install` / `uninstall` / `status` | Manage the main daemon service |
| `install-housekeeping` / `uninstall-housekeeping` / `status-housekeeping` / `logs-housekeeping` | Manage the daily housekeeping timer |
| `install-reflect` / `uninstall-reflect` / `status-reflect` / `logs-reflect` | Manage the daily reflect timer |
| `install-evolve` / `uninstall-evolve` / `status-evolve` / `logs-evolve` | Manage the daily evolve timer |

The built-in schedules are:

- housekeeping: **03:00**
- evolve: **04:00**
- reflect: **05:00**

## Client commands

### TUI slash commands

| Command | Description |
| --- | --- |
| `/model [name]` | Show or switch the active model |
| `/models` | List available models |
| `/auto` | Toggle automatic model routing |
| `/memory` | Query the daemon memory view |
| `/skills` | List installed skills and optionally uninstall local ones |
| `/agents` | List running agents |
| `/workers` / `/sessions` | Aliases for `/agents` |
| `/copy` | Copy the last response to the clipboard |
| `/status` | Show daemon health output |
| `/restart` | Restart the daemon |
| `/cancel` | Cancel the in-flight response |
| `/clear` | Clear the terminal |
| `/help` | Show TUI help |
| `/quit` | Exit the TUI |
| `Escape` | Cancel the in-flight response |

### Telegram commands

| Command | Description |
| --- | --- |
| `/help` | Show Telegram command help |
| `/cancel` | Cancel the in-flight response |
| `/model [name]` | Show or switch the active model |
| `/models` | List available models |
| `/auto` | Toggle automatic model routing |
| `/memory` | Show memory info |
| `/skills` | List installed skills |
| `/agents` / `/workers` | Show active agents |
| `/restart` | Restart the daemon |

## Web UI and LAN authentication

The daemon serves the web client from `web/dist/` at the same address as the API.

- **Default local mode**: `API_BIND=127.0.0.1`, localhost requests bypass auth.
- **LAN mode**: set `API_BIND=0.0.0.0`, configure TOTP or passkeys, then restart Max.
- **TOTP CLI setup**: `max auth setup`
- **Passkey setup**: open the web UI from localhost and use **Auth Setup**

Relevant configuration lives in `~/.max/.env`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | unset |
| `AUTHORIZED_USER_ID` | Allowed Telegram user id | unset |
| `API_PORT` | HTTP port | `7777` |
| `API_BIND` | Bind address | `127.0.0.1` |
| `AUTH_RP_ID` | WebAuthn relying-party id | `localhost` |
| `AUTH_RP_ORIGIN` | Browser origin for passkeys | `http://localhost:${API_PORT}` |
| `AUTH_SESSION_TTL` | Browser session lifetime in hours | `720` |
| `COPILOT_MODEL` | Default model when auto-routing is off | `claude-sonnet-4.6` |
| `WORKER_TIMEOUT` | Delegated agent timeout in milliseconds | `600000` |

See `.env.example` for a commented template.

## HTTP API

### Public and auth routes

| Route | Notes |
| --- | --- |
| `GET /status` | Health check, no auth required |
| `GET /auth/status` | Returns configured auth methods and auth state |
| `GET /auth/bootstrap` | Returns the bearer token for localhost web clients only |
| `POST /auth/login/totp` | Sign in with a 6-digit authenticator code |
| `POST /auth/passkey/auth-options` | Start passkey authentication |
| `POST /auth/passkey/authenticate` | Complete passkey authentication |
| `POST /auth/logout` | Clear the browser session |
| `POST /auth/setup/totp` / `DELETE /auth/setup/totp` | Localhost-only TOTP setup and removal |
| `POST /auth/setup/passkey/register-options` / `POST /auth/setup/passkey/register` | Localhost-only passkey registration |
| `GET /auth/setup/passkeys` / `DELETE /auth/setup/passkey/:credentialId` | Localhost-only passkey management |

### Authenticated routes

| Route | Purpose |
| --- | --- |
| `GET /stream` | SSE stream for TUI and web clients |
| `POST /message` | Queue a prompt for the orchestrator |
| `POST /cancel` | Cancel the current in-flight turn |
| `GET /agents` | Active delegated-agent tasks |
| `GET /agents/status` | Agent roster with running/recent task state |
| `GET /sessions` | Back-compat alias for `/agents` |
| `GET /history?limit=N` | Recent conversation messages for the web client |
| `GET /model` / `POST /model` | Read or switch the active model |
| `GET /models` | List available Copilot models |
| `GET /auto` / `POST /auto` | Read or update router settings |
| `GET /memory` | Return `{ hot, patterns, foresight, domains }` from COG |
| `GET /skills` / `DELETE /skills/:slug` | List skills or remove a local skill |
| `POST /restart` | Restart the daemon |
| `POST /send-photo` | Send a temp-file or URL image to Telegram |
| `POST /cog/trigger` | Dispatch `reflect`, `housekeeping`, `foresight`, or `evolve` |

## Architecture

Max keeps a single persistent orchestrator session and routes all user messages through it.

```text
Telegram ──┐
TUI ───────┼──> HTTP + SSE API ──> persistent orchestrator session (@max)
Web UI ────┘                              │
                                          ├─ delegate_to_agent -> ephemeral agent sessions
                                          └─ COG scheduler / skill dispatch
```

### Bundled agents

- `@max` — orchestrator
- `@coder` — software implementation and debugging
- `@designer` — UI/UX and frontend work
- `@general-purpose` — catch-all research and execution
- `@architect` — planning and architecture
- `@critic` — plan review and gap-finding

Agent definitions ship in `agents/*.agent.md`, are synced into `~/.max/agents/`, and can be overridden locally.

### Skills

Bundled skills live in `skills/`. The current built-in set includes:

- COG skills: `cog-personal`, `cog-explainer`, `cog-humanizer`, `cog-reflect`, `cog-housekeeping`, `cog-foresight`, `cog-evolve`, `cog-history`, `cog-scenario`, `cog-setup`, `cog-commit`
- Other bundled skills: `find-skills`, `frontend-design`, `gogcli`

Max also loads user-local skills from `~/.max/skills/` and global shared skills from `~/.agents/skills/`.

## Runtime data

Everything mutable lives under `~/.max/`:

- `max.db` — SQLite state, auth data, router config, conversation log
- `api-token` — bearer token used by the TUI and localhost web bootstrap
- `sessions/` — Copilot SDK session state and persistent session history
- `agents/` — synced bundled agents plus user overrides
- `skills/` — user-local skills
- `cog/` — memory, system prompt, and archived wiki source data
- `.env` — runtime configuration

Any legacy `~/.max/wiki/` tree is archived into `~/.max/cog/sources/wiki-archive/` on first launch.

## Development

```bash
npm install
npm --prefix web install

npm run build         # daemon + web build
npm run build:daemon  # daemon only
npm run dev           # watch src/daemon.ts
npm run daemon        # one-shot daemon
npm run tui           # local TUI client

npm run web:dev
npm run web:build
npm --prefix web run lint
npm --prefix web run typecheck

node --test web/tests/*.test.ts
```

There is no root `npm test` script. Web tests live under `web/tests/` and use `node:test`.
