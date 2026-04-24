import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentConfig, AgentTaskInfo } from "../src/copilot/agents.ts";
import { buildAgentStatusRoster } from "../src/copilot/agents.ts";

test("buildAgentStatusRoster returns the full registered roster with running and recent tasks", () => {
  const registry: AgentConfig[] = [
    {
      slug: "coder",
      name: "Coder",
      description: "Writes code",
      model: "gpt-5.4",
      systemMessage: "You are Coder.",
    },
    {
      slug: "reviewer",
      name: "Reviewer",
      description: "Reviews code",
      model: "claude-sonnet-4.6",
      systemMessage: "You are Reviewer.",
    },
  ];

  const activeTasks: AgentTaskInfo[] = [
    {
      taskId: "task-running-newer",
      agentSlug: "coder",
      description: "Stream logs",
      status: "running",
      startedAt: 250,
      originChannel: "telegram",
    },
    {
      taskId: "task-running",
      agentSlug: "coder",
      description: "Implement endpoint",
      status: "running",
      startedAt: 200,
      originChannel: "web",
    },
    {
      taskId: "task-completed",
      agentSlug: "coder",
      description: "Old completed task",
      status: "completed",
      result: "Done",
      startedAt: 100,
      completedAt: 150,
      originChannel: "web",
    },
  ];

  const recentTasksByAgent = new Map<string, AgentTaskInfo[]>([
    ["coder", [{
      taskId: "task-completed",
      agentSlug: "coder",
      description: "Old completed task",
      status: "completed",
      result: "Done",
      startedAt: 100,
      completedAt: 150,
      originChannel: "web",
    }]],
    ["reviewer", [{
      taskId: "task-error",
      agentSlug: "reviewer",
      description: "Review PR",
      status: "error",
      result: "Timed out",
      startedAt: 300,
      completedAt: 350,
      originChannel: "tui",
    }]],
  ]);

  assert.deepEqual(buildAgentStatusRoster(registry, activeTasks, recentTasksByAgent), [
    {
      slug: "coder",
      name: "Coder",
      description: "Writes code",
      model: "gpt-5.4",
      runningTasks: [{
        taskId: "task-running-newer",
        description: "Stream logs",
        status: "running",
        result: undefined,
        startedAt: 250,
        completedAt: undefined,
        originChannel: "telegram",
      }, {
        taskId: "task-running",
        description: "Implement endpoint",
        status: "running",
        result: undefined,
        startedAt: 200,
        completedAt: undefined,
        originChannel: "web",
      }],
      recentTasks: [{
        taskId: "task-completed",
        description: "Old completed task",
        status: "completed",
        result: "Done",
        startedAt: 100,
        completedAt: 150,
        originChannel: "web",
      }],
    },
    {
      slug: "reviewer",
      name: "Reviewer",
      description: "Reviews code",
      model: "claude-sonnet-4.6",
      runningTasks: [],
      recentTasks: [{
        taskId: "task-error",
        description: "Review PR",
        status: "error",
        result: "Timed out",
        startedAt: 300,
        completedAt: 350,
        originChannel: "tui",
      }],
    },
  ]);
});
