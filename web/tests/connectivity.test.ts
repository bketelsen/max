import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONNECTION_LOST_SUFFIX,
  RECONNECT_BACKOFF_MS,
  STALE_CONNECTION_THRESHOLD_MS,
  appendConnectionLostMarker,
  classifyAuthRedirectResponse,
  getConnectionUiState,
  getReconnectDelay,
  registerAppReactivationListeners,
  shouldReconnectOnReactivation,
  shouldRestoreHistoryOnReactivation,
} from "../src/lib/connectivity.ts";

function createEventTarget() {
  const listeners = new Map<string, Set<() => void>>();

  return {
    addEventListener(type: string, listener: () => void) {
      let handlers = listeners.get(type);
      if (!handlers) {
        handlers = new Set();
        listeners.set(type, handlers);
      }
      handlers.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

test("manual browser redirects are treated as auth expiry", () => {
  assert.equal(
    classifyAuthRedirectResponse({ ok: false, status: 0, type: "opaqueredirect" }),
    "auth-expired"
  );
  assert.equal(
    classifyAuthRedirectResponse({ ok: false, status: 0, type: "basic" }),
    "auth-expired"
  );
  assert.equal(
    classifyAuthRedirectResponse({ ok: false, status: 401, type: "basic" }),
    "auth-expired"
  );
  assert.equal(
    classifyAuthRedirectResponse({ ok: false, status: 503, type: "basic" }),
    "retry"
  );
  assert.equal(
    classifyAuthRedirectResponse({ ok: true, status: 200, type: "basic" }),
    "ok"
  );
});

test("reconnect backoff follows the capped exponential schedule", () => {
  assert.deepEqual(RECONNECT_BACKOFF_MS, [1000, 2000, 4000, 8000, 16000, 30000]);
  assert.equal(getReconnectDelay(0), 1000);
  assert.equal(getReconnectDelay(4), 16000);
  assert.equal(getReconnectDelay(99), 30000);
});

test("interrupted assistant replies get a single connection lost marker", () => {
  assert.equal(CONNECTION_LOST_SUFFIX, " \u26a0\ufe0f [connection lost]");
  assert.equal(
    appendConnectionLostMarker("Partial reply"),
    `Partial reply${CONNECTION_LOST_SUFFIX}`
  );
  assert.equal(
    appendConnectionLostMarker(`Partial reply${CONNECTION_LOST_SUFFIX}`),
    `Partial reply${CONNECTION_LOST_SUFFIX}`
  );
});

test("connection ui switches to offline read-only mode when the browser is offline", () => {
  assert.deepEqual(
    getConnectionUiState({ browserOnline: false, connected: false }),
    {
      ariaLabel: "Offline",
      composerDisabled: true,
      composerMessage:
        "You're offline. Sending is disabled until you're back online.",
      label: "You're offline",
      state: "offline",
    }
  );
});

test("connection ui keeps the composer disabled until chat is connected", () => {
  assert.deepEqual(
    getConnectionUiState({ browserOnline: true, connected: false }),
    {
      ariaLabel: "Connecting",
      composerDisabled: true,
      composerMessage: "Connecting to Max. Messages will appear once chat is connected.",
      label: "Connecting",
      state: "connecting",
    }
  );
  assert.deepEqual(
    getConnectionUiState({ browserOnline: true, connected: true }),
    {
      ariaLabel: "Connected",
      composerDisabled: false,
      composerMessage: null,
      label: "Online",
      state: "online",
    }
  );
});

test("app reactivation listeners fire for visible resume signals only", () => {
  const documentTarget = createEventTarget();
  const windowTarget = createEventTarget();
  let visibilityState: "hidden" | "visible" = "hidden";
  const triggers: string[] = [];
  let now = 1_000;

  const cleanup = registerAppReactivationListeners({
    document: {
      addEventListener: documentTarget.addEventListener,
      removeEventListener: documentTarget.removeEventListener,
      get visibilityState() {
        return visibilityState;
      },
    },
    now: () => now,
    onReactivate: (source) => triggers.push(source),
    window: windowTarget,
  });

  documentTarget.dispatch("visibilitychange");
  visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  now += 1_500;
  windowTarget.dispatch("pageshow");
  now += 1_500;
  windowTarget.dispatch("focus");
  cleanup();
  windowTarget.dispatch("focus");

  assert.deepEqual(triggers, ["visibilitychange", "pageshow", "focus"]);
});

test("app reactivation listeners coalesce duplicate resume signals from the same tab activation", () => {
  const documentTarget = createEventTarget();
  const windowTarget = createEventTarget();
  let visibilityState: "hidden" | "visible" = "hidden";
  const triggers: string[] = [];
  let now = 1_000;

  registerAppReactivationListeners({
    document: {
      addEventListener: documentTarget.addEventListener,
      removeEventListener: documentTarget.removeEventListener,
      get visibilityState() {
        return visibilityState;
      },
    },
    onReactivate: (source) => triggers.push(source),
    window: windowTarget,
    now: () => now,
  });

  visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  now += 100;
  windowTarget.dispatch("pageshow");
  now += 100;
  windowTarget.dispatch("focus");
  now += 2_000;
  windowTarget.dispatch("focus");

  assert.deepEqual(triggers, ["visibilitychange", "focus"]);
});

test("reactivation reconnects when the stream is missing or stale", () => {
  const now = 120_000;

  assert.equal(
    shouldReconnectOnReactivation({
      browserOnline: true,
      connected: false,
      lastActivityAt: now,
      now,
    }),
    true
  );
  assert.equal(
    shouldReconnectOnReactivation({
      browserOnline: true,
      connected: true,
      lastActivityAt: now - STALE_CONNECTION_THRESHOLD_MS - 1,
      now,
    }),
    true
  );
  assert.equal(
    shouldReconnectOnReactivation({
      browserOnline: true,
      connected: true,
      lastActivityAt: now - STALE_CONNECTION_THRESHOLD_MS + 1,
      now,
    }),
    false
  );
  assert.equal(
    shouldReconnectOnReactivation({
      browserOnline: false,
      connected: false,
      lastActivityAt: null,
      now,
    }),
    false
  );
});

test("reactivation only restores history when local state is empty or stale", () => {
  const now = 120_000;

  assert.equal(
    shouldRestoreHistoryOnReactivation({
      cachedMessageCount: 0,
      lastActivityAt: null,
      now,
    }),
    true
  );
  assert.equal(
    shouldRestoreHistoryOnReactivation({
      cachedMessageCount: 4,
      lastActivityAt: null,
      now,
    }),
    false
  );
  assert.equal(
    shouldRestoreHistoryOnReactivation({
      cachedMessageCount: 4,
      lastActivityAt: now - STALE_CONNECTION_THRESHOLD_MS + 1,
      now,
    }),
    false
  );
  assert.equal(
    shouldRestoreHistoryOnReactivation({
      cachedMessageCount: 4,
      lastActivityAt: now - STALE_CONNECTION_THRESHOLD_MS - 1,
      now,
    }),
    true
  );
});

test("connection ui shows reconnecting copy while the app restores chat after resume", () => {
  assert.deepEqual(
    getConnectionUiState({ browserOnline: true, connected: false, reconnecting: true }),
    {
      ariaLabel: "Reconnecting",
      composerDisabled: true,
      composerMessage: "Reconnecting to Max. Messages stay visible while chat reconnects.",
      label: "Reconnecting",
      state: "reconnecting",
    }
  );
});
