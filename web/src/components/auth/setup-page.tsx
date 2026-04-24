import { useState, useCallback, useEffect } from "react";
import QRCode from "qrcode";
import type { useAuth, PasskeyEntry } from "@/hooks/useAuth";

type AuthHook = ReturnType<typeof useAuth>;

interface SetupPageProps {
  setupTotp: AuthHook["setupTotp"];
  removeTotp: AuthHook["removeTotp"];
  registerPasskey: AuthHook["registerPasskey"];
  listPasskeys: AuthHook["listPasskeys"];
  deletePasskey: AuthHook["deletePasskey"];
  methods: ("totp" | "passkey")[];
  error: string | null;
}

export function SetupPage({
  setupTotp,
  removeTotp,
  registerPasskey,
  listPasskeys,
  deletePasskey,
  methods,
  error,
}: SetupPageProps) {
  const [totpData, setTotpData] = useState<{ secret: string; uri: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshPasskeys = useCallback(async () => {
    const pks = await listPasskeys();
    setPasskeys(pks);
  }, [listPasskeys]);

  useEffect(() => {
    refreshPasskeys();
  }, [refreshPasskeys]);

  const handleSetupTotp = useCallback(async () => {
    setBusy(true);
    const data = await setupTotp();
    if (data) {
      setTotpData(data);
      const dataUrl = await QRCode.toDataURL(data.uri, { width: 200, margin: 2 });
      setQrDataUrl(dataUrl);
    }
    setBusy(false);
  }, [setupTotp]);

  const handleRemoveTotp = useCallback(async () => {
    setBusy(true);
    await removeTotp();
    setTotpData(null);
    setQrDataUrl(null);
    setBusy(false);
  }, [removeTotp]);

  const handleRegisterPasskey = useCallback(async () => {
    setBusy(true);
    await registerPasskey();
    await refreshPasskeys();
    setBusy(false);
  }, [registerPasskey, refreshPasskeys]);

  const handleDeletePasskey = useCallback(
    async (id: string) => {
      setBusy(true);
      await deletePasskey(id);
      await refreshPasskeys();
      setBusy(false);
    },
    [deletePasskey, refreshPasskeys]
  );

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">Max — Auth Setup</h1>
          <p className="text-sm text-muted-foreground">
            Configure authentication to access Max from your LAN.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* TOTP Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Authenticator (TOTP)
          </h2>

          {methods.includes("totp") && !totpData ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm text-emerald-500 font-medium">Configured</span>
              <button
                type="button"
                onClick={handleRemoveTotp}
                disabled={busy}
                className="text-xs text-destructive hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ) : totpData ? (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm">
                Scan this QR code with your authenticator app:
              </p>
              <div className="flex justify-center">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="TOTP QR Code"
                    className="rounded"
                    width={200}
                    height={200}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground break-all text-center font-mono">
                {totpData.secret}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSetupTotp}
              disabled={busy}
              className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {busy ? "Generating…" : "Set up TOTP"}
            </button>
          )}
        </section>

        {/* Passkey Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Passkeys
          </h2>

          {passkeys.length > 0 && (
            <div className="space-y-1">
              {passkeys.map((pk) => (
                <div
                  key={pk.credentialId}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-mono truncate block">
                      {pk.credentialId.slice(0, 20)}…
                    </span>
                    <span className="text-xs text-muted-foreground">{pk.createdAt}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePasskey(pk.credentialId)}
                    disabled={busy}
                    className="text-xs text-destructive hover:underline disabled:opacity-50 shrink-0 ml-2"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleRegisterPasskey}
            disabled={busy}
            className="w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy ? "Waiting for passkey…" : "Register a Passkey"}
          </button>
        </section>

        {/* Info */}
        {(methods.includes("totp") || passkeys.length > 0) && (
          <p className="text-xs text-center text-muted-foreground">
            Set <code className="font-mono bg-muted px-1 rounded">API_BIND=0.0.0.0</code> in{" "}
            <code className="font-mono bg-muted px-1 rounded">~/.max/.env</code> and restart to
            expose Max on your LAN.
          </p>
        )}
      </div>
    </div>
  );
}

/** Shown to LAN clients when auth is not configured. */
export function SetupRequiredPage() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-semibold">Max</h1>
        <p className="text-muted-foreground">
          Authentication has not been configured yet. Visit Max from{" "}
          <code className="font-mono bg-muted px-1 rounded text-sm">http://localhost:7777</code>{" "}
          to set up TOTP or a passkey, or run:
        </p>
        <pre className="bg-muted rounded-md px-4 py-2 text-sm font-mono">max auth setup</pre>
      </div>
    </div>
  );
}
