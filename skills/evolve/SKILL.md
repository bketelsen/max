# Evolve

Systems-level self-improvement — audit memory architecture, evaluate rule effectiveness, and propose structural changes.

## When to Run

- **Manually**: User types `run evolve` or asks to audit the memory system
- **Automatically**: Nightly at 4 AM via systemd timer (between housekeeping at 3 AM and reflect at 5 AM)

## What Evolve Does

1. **Architecture review** — Evaluate memory tier design (hot-memory → wiki → session store), file organization, check for orphaned pages
2. **Process audit** — Review housekeeping and reflect effectiveness via their logs and output
3. **Rule proposals** — Suggest improvements based on evidence (low-risk applied directly, high-risk proposed for review)
4. **Content routing** — Send issues to the right skill (housekeeping for cleanup, reflect for patterns)
5. **Scorecard** — Generate a metrics snapshot at `~/.max/wiki/evolve-scorecard.md`
6. **Logging** — Update `evolve-log.md` and `evolve-observations.md`

## What Evolve Does NOT Do

- Touch memory content (that's reflect's job)
- Fix individual wiki pages (that's housekeeping's job)
- Log observations from conversations (that's reflect's job)

**Evolve changes the rules, not the content.**

## Output

- `~/.max/wiki/evolve-log.md` — Run history with rule changes (append-only)
- `~/.max/wiki/evolve-observations.md` — Architectural issues spotted (append-only)
- `~/.max/wiki/evolve-scorecard.md` — Current metrics snapshot (overwritten each run)

## CLI Usage

```bash
# Preview what would happen
max evolve --dry-run

# Run evolve
max evolve

# Install nightly timer
max service install-evolve

# Check timer status
max service status-evolve

# View logs
max service logs-evolve
```

## Configuration

Set in `~/.max/.env`:
- `EVOLVE_ENABLED=true` — Enable/disable evolve
- `EVOLVE_NOTIFY_TELEGRAM=true` — Send Telegram summary after run
- `EVOLVE_NOTIFY_ON_ERROR_ONLY=false` — Only notify on errors
- `EVOLVE_HOT_MEMORY_CAP=50` — Hot memory line limit
- `EVOLVE_OBSERVATION_ARCHIVE_THRESHOLD=500` — When to suggest archival

## Daily Pipeline

```
3:00 AM — Housekeeping (clean up)
4:00 AM — Evolve (audit architecture)
5:00 AM — Reflect (add insights)
```
