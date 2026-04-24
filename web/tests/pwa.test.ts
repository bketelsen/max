import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PWA_MANIFEST,
  canApplyAppUpdate,
  registerPwaServiceWorker,
  shouldShowIosInstallHint,
} from "../src/lib/pwa.ts";

test("pwa manifest uses standalone app-shell defaults and branded icons", () => {
  assert.equal(PWA_MANIFEST.name, "Max");
  assert.equal(PWA_MANIFEST.short_name, "Max");
  assert.equal(PWA_MANIFEST.display, "standalone");
  assert.equal(PWA_MANIFEST.start_url, "/");
  assert.equal(PWA_MANIFEST.scope, "/");
  assert.equal(PWA_MANIFEST.theme_color, "#0a0a0a");
  assert.equal(PWA_MANIFEST.background_color, "#0a0a0a");
  assert.deepEqual(
    PWA_MANIFEST.icons.map((icon) => `${icon.src}:${icon.sizes}`),
    [
      "/icons/icon-192.png:192x192",
      "/icons/icon-512.png:512x512",
      "/icons/icon-192-maskable.png:192x192",
      "/icons/icon-512-maskable.png:512x512",
      "/icons/apple-touch-icon-180.png:180x180",
    ]
  );
});

test("ios install hint only shows for mobile safari outside standalone mode", () => {
  assert.equal(
    shouldShowIosInstallHint({
      hasBeforeInstallPrompt: false,
      isStandalone: false,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    }),
    true
  );
  assert.equal(
    shouldShowIosInstallHint({
      hasBeforeInstallPrompt: true,
      isStandalone: false,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    }),
    false
  );
  assert.equal(
    shouldShowIosInstallHint({
      hasBeforeInstallPrompt: false,
      isStandalone: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    }),
    false
  );
});

test("app updates wait for streaming replies to finish", () => {
  assert.equal(canApplyAppUpdate("ready"), true);
  assert.equal(canApplyAppUpdate("submitted"), false);
  assert.equal(canApplyAppUpdate("streaming"), false);
  assert.equal(canApplyAppUpdate("error"), true);
});

test("service worker registration loads vite pwa runtime in supported browsers", async () => {
  let registeredScriptUrl: string | undefined;
  let registerCount = 0;

  const registered = await registerPwaServiceWorker({
    isWindowAvailable: true,
    isServiceWorkerSupported: true,
    registerServiceWorker: async (scriptUrl) => {
      registerCount += 1;
      registeredScriptUrl = scriptUrl;
    },
  });

  assert.equal(registered, true);
  assert.equal(registerCount, 1);
  assert.equal(registeredScriptUrl, "/sw.js");
});

test("service worker registration skips unsupported environments", async () => {
  let loadCount = 0;

  const registered = await registerPwaServiceWorker({
    isWindowAvailable: false,
    isServiceWorkerSupported: false,
    registerServiceWorker: async () => {
      loadCount += 1;
    },
  });

  assert.equal(registered, false);
  assert.equal(loadCount, 0);
});
