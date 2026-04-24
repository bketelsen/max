# Housekeeping

Maintain Max's wiki memory system health.

## When to Run

- **Manually**: User asks to "run housekeeping" or `/housekeeping`
- **Automatically**: Nightly at 3 AM via systemd timer

## What It Does

1. **Hot memory pruning** — Moves stale items from `hot-memory.md` to domain pages. Keeps identity/core context, watch items, and recently referenced items.
2. **Observation archival** — Archives observation entries older than 90 days when the file grows past 500 lines.
3. **Wiki link audit** — Finds broken `[[wiki-links]]` and auto-fixes common typos (e.g., `project/` → `projects/`).
4. **Stale L0 detection** — Flags pages where the L0 summary may be outdated relative to content.
5. **Index rebuild** — Regenerates `index.md` from all on-disk pages.

## CLI Usage

```bash
# Preview changes without modifying anything
max housekeeping --dry-run

# Run housekeeping
max housekeeping

# Install nightly timer
max service install-housekeeping

# Check timer status
max service status-housekeeping
```

## Output

Generates a detailed report saved to `~/.max/wiki/housekeeping-YYYY-MM-DD.log` and optionally sends a Telegram summary.

## Configuration

Set in `~/.max/.env`:
- `HOUSEKEEPING_NOTIFY_TELEGRAM=true` — Send Telegram summary after run
- `HOUSEKEEPING_NOTIFY_ON_ERROR_ONLY=false` — Only notify on errors
