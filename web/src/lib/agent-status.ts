import type { ApiClient } from "@/lib/api-client";

export interface AgentTaskSummary {
  taskId: string;
  description: string;
  status: "running" | "completed" | "error";
  result?: string;
  startedAt: number;
  completedAt?: number;
  originChannel?: string;
}

export interface AgentStatusInfo {
  slug: string;
  name: string;
  description: string;
  model: string;
  runningTasks: AgentTaskSummary[];
  recentTasks: AgentTaskSummary[];
}

export interface AgentBadgeState {
  tone: "running" | "succeeded" | "failed" | "idle";
  label: "Running" | "Succeeded" | "Failed" | "Idle";
  task: AgentTaskSummary | null;
}

function getTaskSortTimestamp(task: AgentTaskSummary): number {
  return task.completedAt ?? task.startedAt;
}

function sortTasksByLatestTimestamp(tasks: readonly AgentTaskSummary[]): AgentTaskSummary[] {
  return [...tasks].sort((left, right) => getTaskSortTimestamp(right) - getTaskSortTimestamp(left));
}

export function getAgentStatusDisplayTasks(agent: AgentStatusInfo): AgentTaskSummary[] {
  if (agent.runningTasks.length > 0) {
    return sortTasksByLatestTimestamp(agent.runningTasks);
  }

  const mostRecentTask = sortTasksByLatestTimestamp(agent.recentTasks)[0];
  return mostRecentTask ? [mostRecentTask] : [];
}

export function deriveAgentBadgeState(agent: AgentStatusInfo): AgentBadgeState {
  const currentTask = sortTasksByLatestTimestamp(agent.runningTasks)[0];

  if (currentTask) {
    return {
      tone: "running",
      label: "Running",
      task: currentTask,
    };
  }

  const mostRecentTask = sortTasksByLatestTimestamp(agent.recentTasks)[0];

  if (mostRecentTask?.status === "completed") {
    return {
      tone: "succeeded",
      label: "Succeeded",
      task: mostRecentTask,
    };
  }

  if (mostRecentTask?.status === "error") {
    return {
      tone: "failed",
      label: "Failed",
      task: mostRecentTask,
    };
  }

  return {
    tone: "idle",
    label: "Idle",
    task: null,
  };
}

export function fetchAgentStatuses(apiClient: Pick<ApiClient, "get">) {
  return apiClient.get<AgentStatusInfo[]>("/agents/status");
}
