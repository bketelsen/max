import { Router } from "express";
import type { Request, Response } from "express";
import {
  isAuthConfigured,
  getAuthMethods,
  getPasskeys,
  deletePasskey,
  deleteTotpSecret,
  setTotpSecret,
} from "../store/db.js";
import {
  generateTotpSetup,
  verifyTotp,
  createSessionToken,
  destroySession,
  validateSession,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getRegistrationOptions,
  handleRegistrationResponse,
  getAuthenticationOptions,
  handleAuthenticationResponse,
} from "./auth.js";

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Helper: restrict to localhost
// ---------------------------------------------------------------------------
function isLocalhost(req: Request): boolean {
  const ip = req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function requireLocalhost(req: Request, res: Response): boolean {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: "localhost only" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public routes (no auth required)
// ---------------------------------------------------------------------------

/** Auth status — tells the frontend what's configured and whether the user is authenticated. */
authRouter.get("/auth/status", (req: Request, res: Response) => {
  const configured = isAuthConfigured();
  const methods = getAuthMethods();
  const cookies = parseCookies(req.headers.cookie);
  const authenticated = isLocalhost(req) || (!!cookies.max_session && validateSession(cookies.max_session));
  res.json({ configured, methods, authenticated, localhost: isLocalhost(req) });
});

/** TOTP login — verify a 6-digit code and issue a session cookie. */
authRouter.post("/auth/login/totp", (req: Request, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Provide a 6-digit TOTP code" });
    return;
  }
  if (!verifyTotp(code)) {
    res.status(401).json({ error: "Invalid code" });
    return;
  }
  const token = createSessionToken();
  res.setHeader("Set-Cookie", sessionCookieHeader(token));
  res.json({ ok: true });
});

/** Passkey — generate authentication options (challenge). */
authRouter.post("/auth/passkey/auth-options", async (_req: Request, res: Response) => {
  try {
    const options = await getAuthenticationOptions();
    res.json(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/** Passkey — verify authentication response. */
authRouter.post("/auth/passkey/authenticate", async (req: Request, res: Response) => {
  try {
    const verification = await handleAuthenticationResponse(req.body);
    if (!verification.verified) {
      res.status(401).json({ error: "Passkey verification failed" });
      return;
    }
    const token = createSessionToken();
    res.setHeader("Set-Cookie", sessionCookieHeader(token));
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(401).json({ error: msg });
  }
});

/** Logout — clear session. */
authRouter.post("/auth/logout", (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.max_session) {
    destroySession(cookies.max_session);
  }
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Setup routes (localhost only)
// ---------------------------------------------------------------------------

/** Generate a TOTP secret and return its URI (for QR code). */
authRouter.post("/auth/setup/totp", (req: Request, res: Response) => {
  if (!requireLocalhost(req, res)) return;
  const { secret, uri } = generateTotpSetup();
  setTotpSecret(secret);
  res.json({ secret, uri });
});

/** Remove TOTP configuration. */
authRouter.delete("/auth/setup/totp", (req: Request, res: Response) => {
  if (!requireLocalhost(req, res)) return;
  deleteTotpSecret();
  res.json({ ok: true });
});

/** Passkey — generate registration options. */
authRouter.post("/auth/setup/passkey/register-options", async (req: Request, res: Response) => {
  if (!requireLocalhost(req, res)) return;
  try {
    const options = await getRegistrationOptions();
    res.json(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/** Passkey — verify and store registration response. */
authRouter.post("/auth/setup/passkey/register", async (req: Request, res: Response) => {
  if (!requireLocalhost(req, res)) return;
  try {
    const verification = await handleRegistrationResponse(req.body);
    if (!verification.verified) {
      res.status(400).json({ error: "Registration verification failed" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

/** List registered passkeys. */
authRouter.get("/auth/setup/passkeys", (req: Request, res: Response) => {
  if (!requireLocalhost(req, res)) return;
  const passkeys = getPasskeys().map((p) => ({
    credentialId: p.credential_id,
    createdAt: p.created_at,
  }));
  res.json(passkeys);
});

/** Delete a passkey. */
authRouter.delete("/auth/setup/passkey/:credentialId", (req: Request, res: Response) => {
  if (!requireLocalhost(req, res)) return;
  const credentialId = Array.isArray(req.params.credentialId)
    ? req.params.credentialId[0]
    : req.params.credentialId;
  const deleted = deletePasskey(credentialId);
  if (!deleted) {
    res.status(404).json({ error: "Passkey not found" });
    return;
  }
  res.json({ ok: true });
});
