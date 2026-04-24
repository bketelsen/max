import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("web manifest keeps branding metadata but drops standalone app-shell fields", () => {
  const rawManifest = readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8");

  return rawManifest.then((contents) => {
    const manifest = JSON.parse(contents) as {
      name: string;
      short_name: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; sizes: string }>;
    };

    assert.equal(manifest.name, "Max");
    assert.equal(manifest.short_name, "Max");
    assert.equal(manifest.theme_color, "#0a0a0a");
    assert.equal(manifest.background_color, "#0a0a0a");
    assert.equal("display" in manifest, false);
    assert.equal("start_url" in manifest, false);
    assert.equal("scope" in manifest, false);
    assert.deepEqual(
      manifest.icons.map((icon) => `${icon.src}:${icon.sizes}`),
      [
        "/icons/icon-192.png:192x192",
        "/icons/icon-512.png:512x512",
        "/icons/icon-192-maskable.png:192x192",
        "/icons/icon-512-maskable.png:512x512",
        "/icons/apple-touch-icon-180.png:180x180",
      ]
    );
  });
});

test("main entry does not register a service worker", async () => {
  const mainSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

  assert.equal(mainSource.includes("registerPwaServiceWorker"), false);
  assert.equal(mainSource.includes("serviceWorker"), false);
});

test("index.html keeps the manifest link but drops standalone iOS app meta tags", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.equal(html.includes('rel="manifest" href="/site.webmanifest"'), true);
  assert.equal(html.includes("apple-mobile-web-app-capable"), false);
  assert.equal(html.includes("apple-mobile-web-app-status-bar-style"), false);
  assert.equal(html.includes("apple-mobile-web-app-title"), false);
});
