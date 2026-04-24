# Max

AI orchestrator powered by [Copilot SDK](https://github.com/github/copilot-sdk) — control multiple Copilot CLI sessions from Telegram or a local terminal.

## Highlights

- **Always running** — persistent daemon, not a chat tab. Available from your terminal or your phone.
- **Remembers like a person** — Max's memory is [COG](https://github.com/marciopuga/cog), a three-tier filesystem-resident brain at `~/.max/cog/`. Hot memory and universal patterns ride in the system prompt; domain files (`personal/`, `work/acme/`) load on demand; old entries archive to `glacier/`. Every fact lives in one SSOT file, linked from others via `[[wiki-links]]`. A self-maintaining pipeline (`cog-reflect`, `cog-housekeeping`, `cog-foresight`) runs on its own schedule.
- **Codes while you're away** — spins up real Copilot CLI worker sessions in any directory and reports back when they're done.
- **Learns any skill** — pulls from [skills.sh](https://skills.sh) or builds new skills on demand.
- **Your Copilot subscription** — works with any model your subscription includes (Claude, GPT, Gemini, …). Auto mode picks the right tier per message.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/burkeholland/max/main/install.sh | bash
```

Or install directly with npm:

```bash
npm install -g heymax
```

## Upgrading

If you already have Max installed:

```bash
max update
```

Or manually: `npm install -g heymax@latest`. Your `~/.max/` config carries forward automatically — any legacy `~/.max/wiki/` is archived into `~/.max/cog/sources/wiki-archive/` on first launch (single atomic rename, nothing re-classified), bundled agents are synced (your customizations preserved), and no data is lost.

## Quick Start

### 1. Run setup

```bash
max setup
```

This creates `~/.max/` and walks you through configuration (Telegram bot token, etc.). Telegram is optional — you can use Max with just the terminal UI.

### 2. Make sure Copilot CLI is authenticated

```bash
copilot login
```

### 3. Start Max

```bash
max start
```

### 4. Connect via terminal

In a separate terminal:

```bash
max tui
```

### 5. Talk to Max

From Telegram or the TUI, just send natural language:

- "Start working on the auth bug in ~/dev/myapp"
- "What sessions are running?"
- "Check on the api-tests session"
- "Kill the auth-fix session"
- "What's the capital of France?"

## Run Max as an always-on service (Linux)

For Max to be available all the time without having to keep a terminal open, install it as a systemd **user** service:

```bash
max service install
```

This writes a unit file to `~/.config/systemd/user/max.service` and starts it. No `sudo` required. Subsequent management:

```bash
max service status     # state + recent logs
journalctl --user -u max -f    # follow logs live
systemctl --user restart max   # pick up config changes
max service uninstall  # stop and remove
```

By default the service starts when you log in and stops when you log out. To keep it running across logouts and reboots, enable user-lingering once (the one step that needs sudo):

```bash
sudo loginctl enable-linger $USER
```

macOS and Windows service integrations are not yet built — on those platforms run `max start` inside your terminal multiplexer of choice.

## Commands

| Command | Description |
|---------|-------------|
| `max start` | Start the Max daemon |
| `max tui` | Connect to the daemon via terminal |
| `max setup` | Interactive first-run configuration |
| `max service install` | Install and start Max as a systemd user service (Linux) |
| `max service status` | Show service state and recent logs |
| `max service uninstall` | Stop and remove the service |
| `max update` | Check for and install updates |
| `max help` | Show available commands |

### Flags

| Flag | Description |
|------|-------------|
| `--self-edit` | Allow Max to modify his own source code (use with `max start`) |

### TUI commands

| Command | Description |
|---------|-------------|
| `/model [name]` | Show or switch the current model |
| `/memory` | Show hot memory + domain list from COG |
| `/skills` | List installed skills |
| `/workers` | List active worker sessions |
| `/copy` | Copy last response to clipboard |
| `/status` | Daemon health check |
| `/restart` | Restart the daemon |
| `/cancel` | Cancel the current in-flight message |
| `/clear` | Clear the screen |
| `/help` | Show help |
| `/quit` | Exit the TUI |
| `Escape` | Cancel a running response |

## How it Works

Max runs a persistent **orchestrator Copilot session** — an always-on AI brain that receives your messages and decides how to handle them. For coding tasks, it spawns **worker Copilot sessions** in specific directories. For simple questions, it answers directly.

You can talk to Max from:
- **Telegram** — remote access from your phone (authenticated by user ID)
- **TUI** — local terminal client (no auth needed)

### Memory — COG

Max's memory is **COG** (Cognitive Architecture — based on [marciopuga/cog](https://github.com/marciopuga/cog), adapted for the Copilot SDK). Filesystem-resident, three-tier, domain-partitioned, self-maintaining.

- **Hot / Warm / Glacier** — `hot-memory.md` and universal `cog-meta/patterns.md` ride in every session's system prompt. Domain files (`~/.max/cog/memory/personal/`, `~/.max/cog/memory/work/<job>/`) are loaded on demand by the matching `cog-*` skill. Files over size thresholds are archived to `glacier/` with YAML frontmatter and a catalog in `glacier/index.md`.
- **Single Source of Truth** — every fact lives in one canonical file (`entities.md`, `action-items.md`, `calendar.md`, `health.md`, …). Duplicates elsewhere become `[[wiki-links]]` to the canonical source.
- **Append-only observations** — `observations.md` is a timestamped, tagged, never-edited log of raw events. `cog-reflect` distills clusters of 3+ related observations into patterns.
- **L0 → L1 → L2 retrieval** — every memory file starts with a one-line `<!-- L0: ... -->` summary. Max greps L0 headers before opening files, scans section headers (L1) before reading the full body (L2).
- **Self-maintaining pipeline** — a scheduler runs `cog-reflect` nightly (mines recent conversations, extracts patterns, detects threads), `cog-housekeeping` weekly (archives, prunes hot-memory, rebuilds link index), and `cog-foresight` daily (one strategic nudge written to `cog-meta/foresight-nudge.md`). `max reflect`, `max housekeeping`, `max evolve` CLI entry points (and their systemd timers) dispatch the same skills through `POST /cog/trigger`.
- **Conversational setup** — `cog-setup` walks you through declaring domains ("What do you do for work? Any side projects?") and seeds the directory tree.
- **Migration** — any legacy `~/.max/wiki/` from older Max versions is moved verbatim to `~/.max/cog/sources/wiki-archive/` on first launch. `cog-reflect` surfaces its contents organically over time.

Editing `~/.max/cog/SYSTEM.md` customizes Max's persona and memory rules without touching source code.

## Architecture

```
Telegram ──→ Max Daemon ←── TUI
                │
          Orchestrator Session (Copilot SDK)
                │
      ┌─────────┼─────────┐
   Worker 1  Worker 2  Worker N
```

- **Daemon** (`max start`) — persistent service running Copilot SDK + Telegram bot + HTTP API
- **TUI** (`max tui`) — lightweight terminal client connecting to the daemon
- **Orchestrator** — long-running Copilot session with custom tools for session management
- **Workers** — child Copilot sessions for specific coding tasks

## Development

```bash
# Clone and install
git clone https://github.com/burkeholland/max.git
cd max
npm install

# Watch mode
npm run dev

# Build TypeScript
npm run build
```
