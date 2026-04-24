import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveAgentBadgeState,
  fetchAgentStatuses,
  getAgentStatusDisplayTasks,
  type AgentStatusInfo,
} from "../src/lib/agent-status.ts";

function createAgentStatus(overrides: Partial<AgentStatusInfo> = {}): AgentStatusInfo {
  return {
    slug: "coder",
    name: "Coder",
    description: "Writes code",
    model: "gpt-5.4",
    runningTasks: [],
    recentTasks: [],
    ...overrides,
  };
}

test("deriveAgentBadgeState prefers the most recent running task", () => {
  const state = deriveAgentBadgeState(
    createAgentStatus({
      runningTasks: [
        {
          taskId: "task-1",
          description: "Implement drawer",
          status: "running",
          startedAt: 200,
        },
        {
          taskId: "task-2",
          description: "Handle refresh",
          status: "running",
          startedAt: 240,
        },
      ],
      recentTasks: [
        {
          taskId: "task-0",
          description: "Previous task",
          status: "completed",
          startedAt: 100,
          completedAt: 150,
        },
      ],
    })
  );

  assert.deepEqual(state, {
    tone: "running",
    label: "Running",
    task: {
      taskId: "task-2",
      description: "Handle refresh",
      status: "running",
      startedAt: 240,
    },
  });
});

test("getAgentStatusDisplayTasks returns all running tasks in newest-first order", () => {
  const tasks = getAgentStatusDisplayTasks(
    createAgentStatus({
      runningTasks: [
        {
          taskId: "task-1",
          description: "Implement drawer",
          status: "running",
          startedAt: 200,
        },
        {
          taskId: "task-2",
          description: "Handle refresh",
          status: "running",
          startedAt: 240,
        },
      ],
      recentTasks: [
        {
          taskId: "task-old",
          description: "Older completion",
          status: "completed",
          startedAt: 100,
          completedAt: 150,
        },
      ],
    })
  );

  assert.deepEqual(
    tasks.map((task) => task.taskId),
    ["task-2", "task-1"]
  );
});

test("getAgentStatusDisplayTasks falls back to the latest recent task when idle", () => {
  const tasks = getAgentStatusDisplayTasks(
    createAgentStatus({
      recentTasks: [
        {
          taskId: "task-old",
          description: "Older completion",
          status: "completed",
          startedAt: 100,
          completedAt: 150,
        },
        {
          taskId: "task-new",
          description: "Latest failure",
          status: "error",
          startedAt: 200,
          completedAt: 260,
        },
      ],
    })
  );

  assert.deepEqual(
    tasks.map((task) => task.taskId),
    ["task-new"]
  );
});

test("deriveAgentBadgeState falls back to the most recent completed task", () => {
  const state = deriveAgentBadgeState(
    createAgentStatus({
      recentTasks: [
        {
          taskId: "task-old",
          description: "Earlier failure",
          status: "error",
          startedAt: 100,
          completedAt: 120,
        },
        {
          taskId: "task-new",
          description: "Shipped feature",
          status: "completed",
          startedAt: 200,
          completedAt: 260,
        },
      ],
    })
  );

  assert.equal(state.tone, "succeeded");
  assert.equal(state.label, "Succeeded");
  assert.equal(state.task?.taskId, "task-new");
});

test("deriveAgentBadgeState reports the most recent failed task", () => {
  const state = deriveAgentBadgeState(
    createAgentStatus({
      recentTasks: [
        {
          taskId: "task-success",
          description: "Older success",
          status: "completed",
          startedAt: 120,
          completedAt: 180,
        },
        {
          taskId: "task-fail",
          description: "Latest failure",
          status: "error",
          startedAt: 220,
          completedAt: 240,
        },
      ],
    })
  );

  assert.equal(state.tone, "failed");
  assert.equal(state.label, "Failed");
  assert.equal(state.task?.taskId, "task-fail");
});

test("deriveAgentBadgeState reports idle when an agent has no task history", () => {
  const state = deriveAgentBadgeState(createAgentStatus());

  assert.deepEqual(state, {
    tone: "idle",
    label: "Idle",
    task: null,
  });
});

test("fetchAgentStatuses loads the roster from the agents status endpoint", async () => {
  const calls: string[] = [];
  const payload = [createAgentStatus()];

  const data = await fetchAgentStatuses({
    get: async <T>(path: string) => {
      calls.push(path);
      return payload as T;
    },
    post: async () => {
      throw new Error("not implemented");
    },
  });

  assert.deepEqual(data, payload);
  assert.deepEqual(calls, ["/agents/status"]);
});
