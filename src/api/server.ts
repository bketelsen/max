import express from "express";
import type { Request, Response, NextFunction } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { sendToOrchestrator, getAgentInfo, cancelCurrentMessage, getLastRouteResult } from "../copilot/orchestrator.js";
import { getAgentStatusRoster } from "../copilot/agents.js";
import { sendPhoto } from "../telegram/bot.js";
import { config, persistModel } from "../config.js";
import { getRouterConfig, updateRouterConfig } from "../copilot/router.js";
import { readMemoryFile } from "../cog/fs.js";
import { triggerReflect, triggerHousekeeping, triggerForesight, triggerEvolve, type CogSkillName } from "../cog/scheduler.js";
import { listSkills, removeSkill } from "../copilot/skills.js";
import { restartDaemon } from "../daemon.js";
import { API_TOKEN_PATH, ensureMaxHome } from "../paths.js";
import { authRouter } from "./auth-routes.js";
import { parseCookies, validateSession } from "./auth.js";
import { getRecentConversationMessages, isAuthConfigured } from "../store/db.js";
import { getStaticAssetHeaders } from "./static-asset-headers.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Ensure token file exists (generate on first run)
let apiToken: string | null = null;
try {
  if (existsSync(API_TOKEN_PATH)) {
    apiToken = readFileSync(API_TOKEN_PATH, "utf-8").trim();
  } else {
    ensureMaxHome();
    apiToken = randomBytes(32).toString("hex");
    writeFileSync(API_TOKEN_PATH, apiToken, { mode: 0o600 });
  }
} catch (err) {
  console.error(`[auth] Failed to load/generate API token: ${err}`);
  process.exit(1);
}

const app = express();
app.use(express.json());

// Static web UI (built to web/dist). Serving before auth so the browser can
// fetch index.html and assets without a bearer token; the sensitive API routes
// below still require auth.
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist"
);
app.use(express.static(webDist, {
  setHeaders(res, filePath) {
    const relativePath = `/${path.relative(webDist, filePath).replaceAll(path.sep, "/")}`;
    const headers = getStaticAssetHeaders(relativePath);
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  },
}));

// SPA fallback: serve index.html for any GET that isn't an API path. Lets the
// web UI use client-side routing without 404s on refresh. Must run before the
// auth middleware so HTML navigation to unknown paths doesn't return 401.
const API_PATHS = new Set([
  "/status", "/auth/bootstrap", "/message", "/stream", "/cancel",
  "/agents", "/agents/status", "/sessions", "/model", "/models", "/auto", "/history",
  "/memory", "/skills", "/restart", "/send-photo", "/cog",
]);
const AUTH_PREFIX = "/auth/";
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET") return next();
  if (API_PATHS.has(req.path)) return next();
  if (req.path.startsWith(AUTH_PREFIX)) return next();
  for (const p of API_PATHS) {
    if (req.path.startsWith(p + "/")) return next();
  }
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

// Register auth routes (login, setup, passkey, etc.) — these handle their own
// auth checks internally (public vs localhost-only).
app.use(authRouter);

// Layered authentication middleware:
// 1. Localhost requests → pass (preserves existing dev/TUI UX)
// 2. Valid session cookie (max_session) → pass (LAN browser clients)
// 3. Valid bearer token → pass (TUI/API clients)
// 4. Public paths (/status, /auth/*) → pass
// 5. Otherwise → 401
app.use((req: Request, res: Response, next: NextFunction) => {
  // Public paths
  if (req.path === "/status") return next();
  if (req.path.startsWith(AUTH_PREFIX)) return next();

  // Localhost bypass
  const ip = req.socket.remoteAddress ?? "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (isLocal) return next();

  // Session cookie
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.max_session && validateSession(cookies.max_session)) return next();

  // Bearer token (TUI, API clients, localhost web UI bootstrap)
  if (apiToken) {
    const auth = req.headers.authorization;
    if (auth && auth === `Bearer ${apiToken}`) return next();
  }

  // Auth not configured yet → allow access (first-run scenario on LAN)
  if (!isAuthConfigured()) return next();

  res.status(401).json({ error: "Unauthorized" });
});

// Active SSE connections
const sseClients = new Map<string, Response>();
let connectionCounter = 0;

// Token bootstrap for the web UI. Safe because the server binds to 127.0.0.1
// only; double-checks the remote address as defense in depth.
app.get("/auth/bootstrap", (req: Request, res: Response) => {
  const ip = req.socket.remoteAddress ?? "";
  const isLocal =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLocal) {
    res.status(403).json({ error: "localhost only" });
    return;
  }
  res.json({ token: apiToken });
});

// Health check — intentionally unauthenticated, returns no sensitive data
app.get("/status", (_req: Request, res: Response) => {
  const workers = getAgentInfo();
  res.json({
    status: "ok",
    workers: workers.map((w) => ({
      slug: w.slug,
      taskId: w.taskId,
      description: w.description,
    })),
  });
});

// List agents
app.get("/agents", (_req: Request, res: Response) => {
  res.json(getAgentInfo());
});

app.get("/agents/status", (_req: Request, res: Response) => {
  res.json(getAgentStatusRoster());
});

app.get("/history", (req: Request, res: Response) => {
  const rawLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : Number.NaN;
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;

  res.json(getRecentConversationMessages({ limit, source: "web" }));
});

// Keep /sessions as an alias for backwards compat
app.get("/sessions", (_req: Request, res: Response) => {
  res.json(getAgentInfo());
});

// SSE stream for real-time responses
app.get("/stream", (req: Request, res: Response) => {
  const client = req.headers["x-max-client"];
  const isWeb = typeof client === "string" && client.toLowerCase() === "web";
  const connectionId = `${isWeb ? "web" : "tui"}-${++connectionCounter}`;

  // Disable Nagle so individual token deltas are flushed immediately instead of
  // being coalesced for up to ~40ms. X-Accel-Buffering disables proxy buffering
  // for deployments that sit behind nginx.
  res.socket?.setNoDelay(true);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", connectionId })}\n\n`);

  sseClients.set(connectionId, res);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`:ping\n\n`);
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(connectionId);
  });
});

// Send a message to the orchestrator
app.post("/message", (req: Request, res: Response) => {
  const { prompt, connectionId } = req.body as { prompt?: string; connectionId?: string };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' in request body" });
    return;
  }

  if (!connectionId || !sseClients.has(connectionId)) {
    res.status(400).json({ error: "Missing or invalid 'connectionId'. Connect to /stream first." });
    return;
  }

  const isWeb = connectionId.startsWith("web-");
  const source = isWeb
    ? ({ type: "web", connectionId } as const)
    : ({ type: "tui", connectionId } as const);

  sendToOrchestrator(
    prompt,
    source,
    (text: string, done: boolean) => {
      const sseRes = sseClients.get(connectionId);
      if (sseRes) {
        const event: Record<string, unknown> = {
          type: done ? "message" : "delta",
          content: text,
        };
        if (done) {
          const routeResult = getLastRouteResult();
          if (routeResult) {
            event.route = {
              model: routeResult.model,
              routerMode: routeResult.routerMode,
              tier: routeResult.tier,
              ...(routeResult.overrideName ? { overrideName: routeResult.overrideName } : {}),
            };
          }
        }
        sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
  );

  res.json({ status: "queued" });
});

// Cancel the current in-flight message
app.post("/cancel", async (_req: Request, res: Response) => {
  const cancelled = await cancelCurrentMessage();
  // Notify all SSE clients that the message was cancelled
  for (const [, sseRes] of sseClients) {
    sseRes.write(
      `data: ${JSON.stringify({ type: "cancelled" })}\n\n`
    );
  }
  res.json({ status: "ok", cancelled });
});

// Get or switch model
app.get("/model", (_req: Request, res: Response) => {
  res.json({ model: config.copilotModel });
});
app.post("/model", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model || typeof model !== "string") {
    res.status(400).json({ error: "Missing 'model' in request body" });
    return;
  }
  // Validate against available models before persisting
  try {
    const { getClient } = await import("../copilot/client.js");
    const client = await getClient();
    const models = await client.listModels();
    const match = models.find((m) => m.id === model);
    if (!match) {
      const suggestions = models
        .filter((m) => m.id.includes(model) || m.id.toLowerCase().includes(model.toLowerCase()))
        .map((m) => m.id);
      const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
      res.status(400).json({ error: `Model '${model}' not found.${hint}` });
      return;
    }
  } catch {
    // If we can't validate (client not ready), allow the switch — it'll fail on next message if wrong
  }
  const previous = config.copilotModel;
  config.copilotModel = model;
  persistModel(model);
  res.json({ previous, current: model });
});

// List all available models
app.get("/models", async (_req: Request, res: Response) => {
  try {
    const { getClient } = await import("../copilot/client.js");
    const client = await getClient();
    const models = await client.listModels();
    res.json({ models: models.map((m) => m.id), current: config.copilotModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to list models: ${msg}` });
  }
});

// Get auto-routing config
app.get("/auto", (_req: Request, res: Response) => {
  const routerConfig = getRouterConfig();
  const lastRoute = getLastRouteResult();
  res.json({
    ...routerConfig,
    currentModel: config.copilotModel,
    lastRoute: lastRoute || null,
  });
});

// Update auto-routing config
app.post("/auto", (req: Request, res: Response) => {
  const body = req.body as Partial<{
    enabled: boolean;
    tierModels: Record<string, string>;
    cooldownMessages: number;
  }>;

  const updated = updateRouterConfig(body);
  console.log(`[max] Auto-routing ${updated.enabled ? "enabled" : "disabled"}`);

  res.json(updated);
});

// Snapshot of COG's L0 layer — hot memory, universal patterns, domain list
app.get("/memory", (_req: Request, res: Response) => {
  const hot = readMemoryFile("hot-memory.md");
  const patterns = readMemoryFile("cog-meta/patterns.md");
  const foresight = readMemoryFile("cog-meta/foresight-nudge.md");
  const domainsYml = readMemoryFile("domains.yml");

  // Extract domain IDs from domains.yml (simple line scan — no full parser needed)
  const domains: string[] = [];
  for (const line of domainsYml.split("\n")) {
    const m = line.match(/^\s*-\s*id:\s*(\S+)/);
    if (m) domains.push(m[1]);
  }

  res.json({
    hot,
    patterns,
    foresight,
    domains,
  });
});

// Admin: force-run one of the scheduler-driven COG pipeline skills.
// POST /cog/trigger  { skill: "reflect" | "housekeeping" | "foresight" | "evolve", force?: boolean }
// force defaults to true (the cadence checks exist to pace background runs;
// an explicit admin call almost always wants to bypass them).
app.post("/cog/trigger", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { skill?: string; force?: unknown };
  const skill = body.skill as CogSkillName | undefined;
  const force = body.force === undefined ? true : !!body.force;

  let result;
  switch (skill) {
    case "reflect":      result = triggerReflect(force); break;
    case "housekeeping": result = triggerHousekeeping(force); break;
    case "foresight":    result = triggerForesight(force); break;
    case "evolve":       result = triggerEvolve(force); break;
    default:
      res.status(400).json({ ok: false, error: `skill must be one of: reflect, housekeeping, foresight, evolve (got: ${JSON.stringify(skill)})` });
      return;
  }

  res.status(result.ok ? 200 : 409).json(result);
});

// List skills
app.get("/skills", (_req: Request, res: Response) => {
  const skills = listSkills();
  res.json(skills);
});

// Remove a local skill
app.delete("/skills/:slug", (req: Request, res: Response) => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const result = removeSkill(slug);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
  } else {
    res.json({ ok: true, message: result.message });
  }
});

// Restart daemon
app.post("/restart", (_req: Request, res: Response) => {
  res.json({ status: "restarting" });
  setTimeout(() => {
    restartDaemon().catch((err) => {
      console.error("[max] Restart failed:", err);
    });
  }, 500);
});

// Send a photo to Telegram
app.post("/send-photo", async (req: Request, res: Response) => {
  const { photo, caption } = req.body as { photo?: string; caption?: string };

  if (!photo || typeof photo !== "string") {
    res.status(400).json({ error: "Missing 'photo' (file path or URL) in request body" });
    return;
  }

  // Restrict local file paths to the system temp directory to prevent arbitrary file exfiltration
  if (!photo.startsWith("http://") && !photo.startsWith("https://")) {
    const { resolve } = await import("path");
    const { tmpdir } = await import("os");
    const resolvedPhoto = resolve(photo);
    const allowedBase = resolve(tmpdir());
    if (!resolvedPhoto.startsWith(allowedBase + "/") && resolvedPhoto !== allowedBase) {
      res.status(403).json({ error: "Local file paths must be within the system temp directory. Use a URL or save the file to the temp dir first." });
      return;
    }
  }

  try {
    await sendPhoto(photo, caption);
    res.json({ status: "sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.apiPort, config.apiBind, () => {
      console.log(`[max] HTTP API listening on http://${config.apiBind}:${config.apiPort}`);
      resolve();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${config.apiPort} is already in use. Is another Max instance running?`));
      } else {
        reject(err);
      }
    });
  });
}

/** Broadcast a proactive message to all connected SSE clients (for background task completions). */
export function broadcastToSSE(text: string): void {
  for (const [, res] of sseClients) {
    res.write(
      `data: ${JSON.stringify({ type: "message", content: text })}\n\n`
    );
  }
}
