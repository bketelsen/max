import type { AuthMethod, AuthStatus } from "@/hooks/useAuth";

export const AUTH_CACHE_STORAGE_KEY = "max.web.auth-cache";

export type CachedAuthStatus = AuthStatus & {
  cachedAt: number;
  userId: string | null;
};

type SerializableAuthStatus = Pick<
  CachedAuthStatus,
  "authenticated" | "configured" | "localhost" | "methods" | "userId"
>;

export function serializeAuthCache(
  status: SerializableAuthStatus,
  now = Date.now()
): string | null {
  if (!status.authenticated) {
    return null;
  }

  return JSON.stringify({
    authenticated: status.authenticated,
    cachedAt: now,
    configured: status.configured,
    localhost: status.localhost,
    methods: status.methods,
    userId: status.userId,
  } satisfies CachedAuthStatus);
}

export function parseAuthCache(raw: string | null): CachedAuthStatus | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.authenticated !== true ||
      typeof parsed.configured !== "boolean" ||
      typeof parsed.localhost !== "boolean" ||
      typeof parsed.cachedAt !== "number" ||
      !Array.isArray(parsed.methods) ||
      parsed.methods.some((method) => method !== "totp" && method !== "passkey") ||
      (parsed.userId !== null && parsed.userId !== undefined && typeof parsed.userId !== "string")
    ) {
      return null;
    }

    return {
      authenticated: true,
      cachedAt: parsed.cachedAt,
      configured: parsed.configured,
      localhost: parsed.localhost,
      methods: parsed.methods as AuthMethod[],
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
    };
  } catch {
    return null;
  }
}

export function shouldClearAuthCache(
  cached: Pick<CachedAuthStatus, "userId">,
  next: Pick<AuthStatus, "authenticated"> & { userId?: string | null }
): boolean {
  if (!next.authenticated) {
    return true;
  }

  if (
    cached.userId &&
    next.userId &&
    cached.userId !== next.userId
  ) {
    return true;
  }

  return false;
}
