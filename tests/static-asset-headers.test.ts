import assert from "node:assert/strict";
import { test } from "node:test";

import { getStaticAssetHeaders } from "../src/api/static-asset-headers.ts";

test("service worker requests fall back to default static asset headers", () => {
  assert.deepEqual(getStaticAssetHeaders("/sw.js"), {});
});

test("web manifest responses get the correct content type", () => {
  assert.deepEqual(getStaticAssetHeaders("/site.webmanifest"), {
    "Content-Type": "application/manifest+json",
  });
});

test("other static assets use default express headers", () => {
  assert.deepEqual(getStaticAssetHeaders("/assets/index.js"), {});
});
