import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTH_CACHE_STORAGE_KEY,
  parseAuthCache,
  serializeAuthCache,
  shouldClearAuthCache,
  type CachedAuthStatus,
} from "../src/lib/auth-cache.ts";

test("auth cache serializes authenticated status with a timestamp", () => {
  const serialized = serializeAuthCache(
    {
      authenticated: true,
      configured: true,
      localhost: false,
      methods: ["totp", "passkey"],
      userId: "max-owner",
    },
    1234
  );

  assert.equal(AUTH_CACHE_STORAGE_KEY, "max.web.auth-cache");
  assert.equal(
    serialized,
    JSON.stringify({
      authenticated: true,
      cachedAt: 1234,
      configured: true,
      localhost: false,
      methods: ["totp", "passkey"],
      userId: "max-owner",
    })
  );
});

test("auth cache ignores unauthenticated states", () => {
  assert.equal(
    serializeAuthCache({
      authenticated: false,
      configured: true,
      localhost: false,
      methods: ["totp"],
      userId: null,
    }),
    null
  );
});

test("auth cache restores only valid authenticated entries", () => {
  const restored = parseAuthCache(
    JSON.stringify({
      authenticated: true,
      cachedAt: 1234,
      configured: true,
      localhost: false,
      methods: ["totp"],
      userId: "max-owner",
    })
  );

  assert.deepEqual(restored, {
    authenticated: true,
    cachedAt: 1234,
    configured: true,
    localhost: false,
    methods: ["totp"],
    userId: "max-owner",
  });
  assert.equal(parseAuthCache(JSON.stringify({ authenticated: false })), null);
  assert.equal(parseAuthCache("not json"), null);
});

test("auth cache clears when auth expires or the user changes", () => {
  const cached: CachedAuthStatus = {
    authenticated: true,
    cachedAt: 1234,
    configured: true,
    localhost: false,
    methods: ["totp"],
    userId: "max-owner",
  };

  assert.equal(
    shouldClearAuthCache(cached, {
      authenticated: false,
      configured: true,
      localhost: false,
      methods: ["totp"],
      userId: null,
    }),
    true
  );

  assert.equal(
    shouldClearAuthCache(cached, {
      authenticated: true,
      configured: true,
      localhost: false,
      methods: ["totp"],
      userId: "another-user",
    }),
    true
  );

  assert.equal(
    shouldClearAuthCache(cached, {
      authenticated: true,
      configured: true,
      localhost: false,
      methods: ["totp"],
      userId: "max-owner",
    }),
    false
  );
});
