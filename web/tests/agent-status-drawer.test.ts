import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_STATUS_DRAWER_BODY_CLASS_NAME,
  AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME,
} from "../src/components/agent-status-drawer.tsx";

test("agent status drawer keeps a shrinkable content row for overflow on mobile", () => {
  assert.equal(AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME.includes("max-h-[85dvh]"), true);
  assert.equal(
    AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME.includes("grid-rows-[auto_minmax(0,1fr)]"),
    true
  );
});

test("agent status drawer preserves the existing desktop sheet sizing", () => {
  assert.equal(
    AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME.includes("sm:max-h-[calc(100dvh-2rem)]"),
    true
  );
  assert.equal(AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME.includes("sm:w-[360px]"), true);
  assert.equal(AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME.includes("sm:max-w-[360px]"), true);
});

test("agent status drawer body enables touch-friendly scrolling", () => {
  assert.equal(AGENT_STATUS_DRAWER_BODY_CLASS_NAME.includes("min-h-0"), true);
  assert.equal(AGENT_STATUS_DRAWER_BODY_CLASS_NAME.includes("overflow-y-auto"), true);
  assert.equal(
    AGENT_STATUS_DRAWER_BODY_CLASS_NAME.includes("[-webkit-overflow-scrolling:touch]"),
    true
  );
  assert.equal(
    AGENT_STATUS_DRAWER_BODY_CLASS_NAME.includes("[overscroll-behavior-y:contain]"),
    true
  );
});
