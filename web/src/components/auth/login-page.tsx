import { useState, useRef, useCallback, useEffect } from "react";
import type { useAuth } from "@/hooks/useAuth";

type AuthHook = ReturnType<typeof useAuth>;

interface LoginPageProps {
  methods: ("totp" | "passkey")[];
  loginTotp: AuthHook["loginTotp"];
  loginPasskey: AuthHook["loginPasskey"];
  error: string | null;
}

export function LoginPage({ methods, loginTotp, loginPasskey, error }: LoginPageProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleTotp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (code.length !== 6) return;
      setBusy(true);
      await loginTotp(code);
      setBusy(false);
      setCode("");
    },
    [code, loginTotp]
  );

  const handlePasskey = useCallback(async () => {
    setBusy(true);
    await loginPasskey();
    setBusy(false);
  }, [loginPasskey]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">Max</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {methods.includes("totp") && (
          <form onSubmit={handleTotp} className="space-y-3">
            <label htmlFor="totp-code" className="block text-sm font-medium">
              Authenticator code
            </label>
            <input
              ref={inputRef}
              id="totp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-md border bg-background px-3 py-2 text-center text-lg tracking-[0.3em] font-mono placeholder:tracking-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={code.length !== 6 || busy}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
          </form>
        )}

        {methods.includes("totp") && methods.includes("passkey") && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>
        )}

        {methods.includes("passkey") && (
          <button
            type="button"
            onClick={handlePasskey}
            disabled={busy}
            className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Waiting for passkey…" : "Sign in with Passkey"}
          </button>
        )}
      </div>
    </div>
  );
}
