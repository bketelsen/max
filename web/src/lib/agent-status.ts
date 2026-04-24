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
  currentTask: AgentTaskSummary | null;
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

export function deriveAgentBadgeState(agent: AgentStatusInfo): AgentBadgeState {
  if (agent.currentTask) {
    return {
      tone: "running",
      label: "Running",
      task: agent.currentTask,
    };
  }

  const mostRecentTask = [...agent.recentTasks].sort(
    (left, right) => getTaskSortTimestamp(right) - getTaskSortTimestamp(left)
  )[0];

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
