import { useCallback, useEffect, useState } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

export type AuthMethod = "totp" | "passkey";

export interface AuthStatus {
  configured: boolean;
  methods: AuthMethod[];
  authenticated: boolean;
  localhost: boolean;
}

export interface PasskeyEntry {
  credentialId: string;
  createdAt: string;
}

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/auth/status", { credentials: "include" });
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      const data = (await res.json()) as AuthStatus;
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Log in with a 6-digit TOTP code. */
  const loginTotp = useCallback(
    async (code: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch("/auth/login/totp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          setError(body.error ?? "Login failed");
          return false;
        }
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [refresh]
  );

  /** Log in with a passkey (WebAuthn). */
  const loginPasskey = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      // Get authentication options from server
      const optionsRes = await fetch("/auth/passkey/auth-options", {
        method: "POST",
        credentials: "include",
      });
      if (!optionsRes.ok) throw new Error("Failed to get authentication options");
      const options = await optionsRes.json();

      // Trigger browser WebAuthn prompt
      const credential = await startAuthentication({ optionsJSON: options });

      // Verify with server
      const verifyRes = await fetch("/auth/passkey/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credential),
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes.json()) as { error?: string };
        setError(body.error ?? "Passkey authentication failed");
        return false;
      }
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [refresh]);

  /** Log out — clear session cookie. */
  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    await refresh();
  }, [refresh]);

  // ---------------------------------------------------------------------------
  // Setup helpers (localhost only)
  // ---------------------------------------------------------------------------

  /** Generate TOTP secret (localhost only). */
  const setupTotp = useCallback(async (): Promise<{ secret: string; uri: string } | null> => {
    setError(null);
    try {
      const res = await fetch("/auth/setup/totp", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "TOTP setup failed");
        return null;
      }
      const data = (await res.json()) as { secret: string; uri: string };
      await refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [refresh]);

  /** Remove TOTP config (localhost only). */
  const removeTotp = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/auth/setup/totp", {
      method: "DELETE",
      credentials: "include",
    });
    await refresh();
    return res.ok;
  }, [refresh]);

  /** Register a new passkey (localhost only). */
  const registerPasskey = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      // Get registration options
      const optionsRes = await fetch("/auth/setup/passkey/register-options", {
        method: "POST",
        credentials: "include",
      });
      if (!optionsRes.ok) throw new Error("Failed to get registration options");
      const options = await optionsRes.json();

      // Trigger browser WebAuthn registration
      const credential = await startRegistration({ optionsJSON: options });

      // Send to server
      const verifyRes = await fetch("/auth/setup/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credential),
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes.json()) as { error?: string };
        setError(body.error ?? "Passkey registration failed");
        return false;
      }
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [refresh]);

  /** List registered passkeys (localhost only). */
  const listPasskeys = useCallback(async (): Promise<PasskeyEntry[]> => {
    const res = await fetch("/auth/setup/passkeys", { credentials: "include" });
    if (!res.ok) return [];
    return (await res.json()) as PasskeyEntry[];
  }, []);

  /** Delete a passkey (localhost only). */
  const deletePasskey = useCallback(
    async (credentialId: string): Promise<boolean> => {
      const res = await fetch(`/auth/setup/passkey/${encodeURIComponent(credentialId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      await refresh();
      return res.ok;
    },
    [refresh]
  );

  return {
    status,
    loading,
    error,
    refresh,
    loginTotp,
    loginPasskey,
    logout,
    // Setup (localhost)
    setupTotp,
    removeTotp,
    registerPasskey,
    listPasskeys,
    deletePasskey,
  };
}
