import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { ENV_PATH, ensureMaxHome } from "./paths.js";

// Load from ~/.max/.env, fall back to cwd .env for dev
loadEnv({ path: ENV_PATH });
loadEnv(); // also check cwd for backwards compat

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  AUTHORIZED_USER_ID: z.string().min(1).optional(),
  API_PORT: z.string().optional(),
  API_BIND: z.string().optional(),
  AUTH_RP_ID: z.string().optional(),
  AUTH_RP_ORIGIN: z.string().optional(),
  AUTH_SESSION_TTL: z.string().optional(),
  COPILOT_MODEL: z.string().optional(),
  WORKER_TIMEOUT: z.string().optional(),
  REFLECT_ENABLED: z.string().optional(),
  REFLECT_NOTIFY_TELEGRAM: z.string().optional(),
  REFLECT_NOTIFY_ON_ERROR_ONLY: z.string().optional(),
  REFLECT_HOURS: z.string().optional(),
  REFLECT_PATTERN_THRESHOLD: z.string().optional(),
});

const raw = configSchema.parse(process.env);

const parsedUserId = raw.AUTHORIZED_USER_ID
  ? parseInt(raw.AUTHORIZED_USER_ID, 10)
  : undefined;
const parsedPort = parseInt(raw.API_PORT || "7777", 10);

if (parsedUserId !== undefined && (Number.isNaN(parsedUserId) || parsedUserId <= 0)) {
  throw new Error(`AUTHORIZED_USER_ID must be a positive integer, got: "${raw.AUTHORIZED_USER_ID}"`);
}
if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error(`API_PORT must be 1-65535, got: "${raw.API_PORT}"`);
}

const DEFAULT_WORKER_TIMEOUT_MS = 600_000; // 10 minutes
const parsedWorkerTimeout = raw.WORKER_TIMEOUT
  ? Number(raw.WORKER_TIMEOUT)
  : DEFAULT_WORKER_TIMEOUT_MS;

if (!Number.isInteger(parsedWorkerTimeout) || parsedWorkerTimeout <= 0) {
  throw new Error(`WORKER_TIMEOUT must be a positive integer (ms), got: "${raw.WORKER_TIMEOUT}"`);
}

export const DEFAULT_MODEL = "claude-sonnet-4.6";

let _copilotModel = raw.COPILOT_MODEL || DEFAULT_MODEL;

const DEFAULT_SESSION_TTL_HOURS = 720; // 30 days
const parsedSessionTtl = raw.AUTH_SESSION_TTL
  ? Number(raw.AUTH_SESSION_TTL)
  : DEFAULT_SESSION_TTL_HOURS;

export const config = {
  telegramBotToken: raw.TELEGRAM_BOT_TOKEN,
  authorizedUserId: parsedUserId,
  apiPort: parsedPort,
  apiBind: raw.API_BIND || "127.0.0.1",
  authRpId: raw.AUTH_RP_ID || "localhost",
  authRpOrigin: raw.AUTH_RP_ORIGIN || `http://localhost:${parsedPort}`,
  authSessionTtlHours: parsedSessionTtl,
  workerTimeoutMs: parsedWorkerTimeout,
  get copilotModel(): string {
    return _copilotModel;
  },
  set copilotModel(model: string) {
    _copilotModel = model;
  },
  get telegramEnabled(): boolean {
    return !!this.telegramBotToken && this.authorizedUserId !== undefined;
  },
  get selfEditEnabled(): boolean {
    return process.env.MAX_SELF_EDIT === "1";
  },
};

/** Update or append an env var in ~/.max/.env */
function persistEnvVar(key: string, value: string): void {
  ensureMaxHome();
  try {
    const content = readFileSync(ENV_PATH, "utf-8");
    const lines = content.split("\n");
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    writeFileSync(ENV_PATH, updated.join("\n"));
  } catch {
    // File doesn't exist — create it
    writeFileSync(ENV_PATH, `${key}=${value}\n`);
  }
}

/** Persist the current model choice to ~/.max/.env */
export function persistModel(model: string): void {
  persistEnvVar("COPILOT_MODEL", model);
}
