import assert from "node:assert/strict";
import { test } from "node:test";

import { getStaticAssetHeaders } from "../src/api/static-asset-headers.ts";

test("service worker responses get scope and no-cache headers", () => {
  assert.deepEqual(getStaticAssetHeaders("/sw.js"), {
    "Cache-Control": "no-cache",
    "Service-Worker-Allowed": "/",
  });
});

test("web manifest responses get the correct content type", () => {
  assert.deepEqual(getStaticAssetHeaders("/site.webmanifest"), {
    "Content-Type": "application/manifest+json",
  });
});

test("other static assets use default express headers", () => {
  assert.deepEqual(getStaticAssetHeaders("/assets/index.js"), {});
});
