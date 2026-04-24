import type { ManifestOptions } from "vite-plugin-pwa";

export const PWA_MANIFEST = {
  name: "Max",
  short_name: "Max",
  description: "Max, your personal AI assistant for developers.",
  background_color: "#0a0a0a",
  theme_color: "#0a0a0a",
  display: "standalone",
  start_url: "/",
  scope: "/",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" },
  ],
} satisfies Partial<ManifestOptions>;

export type UpdatableChatStatus = "ready" | "submitted" | "streaming" | "error";

type ServiceWorkerNavigator = Navigator & {
  serviceWorker: {
    register: (scriptUrl: string) => Promise<unknown> | unknown;
  };
};

type RegisterPwaServiceWorkerOptions = {
  isWindowAvailable?: boolean;
  isServiceWorkerSupported?: boolean;
  registerServiceWorker?: (scriptUrl: string) => Promise<unknown> | unknown;
};

type InstallHintState = {
  hasBeforeInstallPrompt: boolean;
  isStandalone: boolean;
  userAgent: string;
};

export function shouldShowIosInstallHint({
  hasBeforeInstallPrompt,
  isStandalone,
  userAgent,
}: InstallHintState): boolean {
  if (hasBeforeInstallPrompt || isStandalone) {
    return false;
  }

  const normalized = userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(normalized);
  const isSafari = normalized.includes("safari") && !normalized.includes("crios") && !normalized.includes("fxios");

  return isIos && isSafari;
}

export function canApplyAppUpdate(status: UpdatableChatStatus): boolean {
  return status !== "submitted" && status !== "streaming";
}

export async function registerPwaServiceWorker(
  options: RegisterPwaServiceWorkerOptions = {}
): Promise<boolean> {
  const isWindowAvailable = options.isWindowAvailable ?? "window" in globalThis;
  const isServiceWorkerSupported =
    options.isServiceWorkerSupported ?? ("navigator" in globalThis && "serviceWorker" in globalThis.navigator);

  if (!isWindowAvailable || !isServiceWorkerSupported) {
    return false;
  }

  const registerServiceWorker =
    options.registerServiceWorker ??
    ((scriptUrl: string) => (globalThis.navigator as ServiceWorkerNavigator).serviceWorker.register(scriptUrl));
  await registerServiceWorker("/sw.js");

  return true;
}
