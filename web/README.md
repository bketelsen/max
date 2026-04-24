# Max web UI

React 19 + Vite web client for the Max daemon. The app streams responses over SSE, restores recent history from the daemon, exposes slash commands, shows agent status, and handles localhost auth setup plus LAN login.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
npm run typecheck
node --test tests/*.test.ts
```

## Development flow

1. Start the Max daemon on `http://127.0.0.1:7777`:

   ```bash
   max start
   ```

2. In `web/`, run the Vite dev server:

   ```bash
   npm run dev
   ```

The Vite config proxies `/auth`, `/stream`, `/message`, `/cancel`, `/status`, `/agents`, `/history`, `/model`, `/models`, `/auto`, `/memory`, and `/skills` to the daemon.

## What the app does

- Streams chat responses from `/stream`
- Sends prompts to `/message`
- Restores recent chat history from `/history`
- Supports slash commands for help, clear, cancel, model switching, auto routing, memory, skills, agents, and status
- Shows the agent roster and recent/running task state from `/agents/status`
- Registers a service worker and PWA manifest for installable use
- Supports localhost auth setup and LAN login with TOTP or passkeys

## Important files

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Main shell, auth gating, chat surface, agent drawer |
| `src/hooks/useMaxChat.ts` | SSE lifecycle, reconnects, history hydration, message state |
| `src/hooks/useAuth.ts` | TOTP/passkey login and setup calls |
| `src/lib/slash-commands.ts` | Slash command registry |
| `src/lib/slash-command-actions.ts` | Slash command behavior |
| `src/lib/pwa.ts` | Manifest and service-worker helpers |
| `tests/` | `node:test` coverage for client-side logic |
