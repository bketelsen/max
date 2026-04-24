import { randomBytes } from "crypto";
import { TOTP, Secret } from "otpauth";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  GenerateRegistrationOptionsOpts,
  VerifiedRegistrationResponse,
  GenerateAuthenticationOptionsOpts,
  VerifiedAuthenticationResponse,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { config } from "../config.js";
import {
  getTotpSecret,
  getPasskeys,
  getPasskeyById,
  addPasskey,
  updatePasskeyCounter,
  createAuthSession,
  validateAuthSession,
  deleteAuthSession,
  pruneExpiredSessions,
} from "../store/db.js";

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

/** Generate a new TOTP secret and return its base32 value + otpauth URI. */
export function generateTotpSetup(): { secret: string; uri: string } {
  const totp = new TOTP({
    issuer: "Max",
    label: "Max",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new Secret({ size: 20 }),
  });
  return { secret: totp.secret.base32, uri: totp.toString() };
}

/** Verify a 6-digit TOTP code against the stored secret. */
export function verifyTotp(code: string): boolean {
  const secret = getTotpSecret();
  if (!secret) return false;

  const totp = new TOTP({
    issuer: "Max",
    label: "Max",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  // Allow 1-step window in each direction (±30s)
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/** Verify a TOTP code against an arbitrary secret (used during CLI setup to confirm before saving). */
export function verifyTotpWithSecret(code: string, secret: string): boolean {
  const totp = new TOTP({
    issuer: "Max",
    label: "Max",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Create a session token, store it in the DB, and return the raw token. */
export function createSessionToken(): string {
  pruneExpiredSessions();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.authSessionTtlHours * 3600_000);
  createAuthSession(token, expiresAt);
  return token;
}

/** Validate a session token. */
export function validateSession(token: string): boolean {
  return validateAuthSession(token);
}

/** Destroy a session. */
export function destroySession(token: string): void {
  deleteAuthSession(token);
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Parse cookies from a Cookie header string. */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = val;
  }
  return cookies;
}

/** Build the Set-Cookie header value for a session token. */
export function sessionCookieHeader(token: string): string {
  const maxAge = config.authSessionTtlHours * 3600;
  const secure = config.authRpOrigin.startsWith("https://") ? "; Secure" : "";
  return `max_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

/** Build a Set-Cookie that clears the session cookie. */
export function clearSessionCookieHeader(): string {
  return "max_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

// ---------------------------------------------------------------------------
// WebAuthn / Passkeys — in-memory challenge store
// ---------------------------------------------------------------------------

// Challenges are ephemeral and short-lived; no need to persist.
const challengeStore = new Map<string, { challenge: string; expires: number }>();

function storeChallenge(key: string, challenge: string): void {
  challengeStore.set(key, { challenge, expires: Date.now() + 5 * 60_000 });
}

function consumeChallenge(key: string): string | null {
  const entry = challengeStore.get(key);
  if (!entry) return null;
  challengeStore.delete(key);
  if (Date.now() > entry.expires) return null;
  return entry.challenge;
}

/** Generate WebAuthn registration options for a new passkey. */
export async function getRegistrationOptions() {
  const existing = getPasskeys();
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: "Max",
    rpID: config.authRpId,
    userName: "max-owner",
    userDisplayName: "Max Owner",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  };
  const options = await generateRegistrationOptions(opts);
  storeChallenge("registration", options.challenge);
  return options;
}

/** Verify a registration response and store the credential. */
export async function handleRegistrationResponse(
  body: RegistrationResponseJSON
): Promise<VerifiedRegistrationResponse> {
  const expectedChallenge = consumeChallenge("registration");
  if (!expectedChallenge) throw new Error("Registration challenge expired or missing");

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: config.authRpOrigin,
    expectedRPID: config.authRpId,
  });

  if (verification.verified && verification.registrationInfo) {
    const { credential } = verification.registrationInfo;
    addPasskey(
      credential.id,
      Buffer.from(credential.publicKey).toString("base64url"),
      credential.counter,
      (credential.transports ?? []) as string[],
    );
  }

  return verification;
}

/** Generate WebAuthn authentication options. */
export async function getAuthenticationOptions() {
  const existing = getPasskeys();
  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: config.authRpId,
    userVerification: "preferred",
    allowCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[]) : undefined,
    })),
  };
  const options = await generateAuthenticationOptions(opts);
  storeChallenge("authentication", options.challenge);
  return options;
}

/** Verify an authentication response. Returns true on success. */
export async function handleAuthenticationResponse(
  body: AuthenticationResponseJSON
): Promise<VerifiedAuthenticationResponse> {
  const expectedChallenge = consumeChallenge("authentication");
  if (!expectedChallenge) throw new Error("Authentication challenge expired or missing");

  const credentialId = body.id;
  const stored = getPasskeyById(credentialId);
  if (!stored) throw new Error("Unknown credential");

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: config.authRpOrigin,
    expectedRPID: config.authRpId,
    credential: {
      id: stored.credential_id,
      publicKey: Buffer.from(stored.public_key, "base64url"),
      counter: stored.counter,
      transports: stored.transports ? (JSON.parse(stored.transports) as AuthenticatorTransportFuture[]) : undefined,
    },
  });

  if (verification.verified) {
    updatePasskeyCounter(credentialId, verification.authenticationInfo.newCounter);
  }

  return verification;
}
