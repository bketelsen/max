import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createApiClient } from "../src/lib/api-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createApiClient includes auth and client headers on GET requests", async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;

  globalThis.fetch = (async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  const client = createApiClient("secret-token");
  const payload = await client.get("/status");
  const headers = new Headers(request?.init?.headers);

  assert.deepEqual(payload, { status: "ok" });
  assert.equal(request?.input, "/status");
  assert.equal(request?.init?.credentials, "include");
  assert.equal(headers.get("Authorization"), "Bearer secret-token");
  assert.equal(headers.get("X-Max-Client"), "web");
});

test("createApiClient surfaces API errors from JSON responses", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Model not found" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    })) as typeof fetch;

  const client = createApiClient(null);

  await assert.rejects(
    () => client.post("/model", { model: "bad-model" }),
    /Model not found/
  );
});
