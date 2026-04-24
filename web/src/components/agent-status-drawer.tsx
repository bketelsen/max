import React, { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { AlertCircleIcon, ChevronDownIcon, RefreshCwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ApiClient } from "@/lib/api-client";
import {
  deriveAgentBadgeState,
  fetchAgentStatuses,
  getAgentStatusDisplayTasks,
  type AgentStatusInfo,
  type AgentTaskSummary,
} from "@/lib/agent-status";
import { cn } from "@/lib/utils";

type AgentStatusDrawerProps = Pick<ComponentProps<typeof Dialog>, "open" | "onOpenChange"> & {
  apiClient: ApiClient;
};

export const AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME =
  "top-auto right-0 bottom-0 left-0 grid max-h-[85dvh] max-w-none grid-rows-[auto_minmax(0,1fr)] translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-b-none rounded-t-2xl p-0 sm:top-4 sm:right-4 sm:bottom-4 sm:left-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[360px] sm:max-w-[360px] sm:rounded-xl";

export const AGENT_STATUS_DRAWER_BODY_CLASS_NAME =
  "min-h-0 overflow-y-auto p-4 [overscroll-behavior-y:contain] [-webkit-overflow-scrolling:touch]";

const badgeToneClassNames = {
  running: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  succeeded: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/20 bg-destructive/10 text-destructive",
  idle: "border-border bg-background text-muted-foreground",
} as const;

function formatTimestamp(timestamp?: number): string | null {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function getTaskMeta(task: AgentTaskSummary | null): string {
  if (!task) {
    return "No runs yet.";
  }

  const when = formatTimestamp(task.status === "running" ? task.startedAt : task.completedAt ?? task.startedAt);
  const parts = [
    task.status === "running" ? "Started" : "Updated",
    when,
    task.originChannel ? `via ${task.originChannel}` : null,
  ].filter(Boolean);

  return parts.join(" · ");
}

export function AgentStatusCard({ agent }: { agent: AgentStatusInfo }) {
  const badge = deriveAgentBadgeState(agent);
  const tasks = useMemo(() => getAgentStatusDisplayTasks(agent), [agent]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);

  const toggleTask = useCallback((taskId: string) => {
    setExpandedTaskIds((currentTaskIds) =>
      currentTaskIds.includes(taskId)
        ? currentTaskIds.filter((currentTaskId) => currentTaskId !== taskId)
        : [...currentTaskIds, taskId]
    );
  }, []);

  return (
    <div className="space-y-3 rounded-xl border bg-card/70 p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{agent.name}</h3>
            <Badge variant="outline" className="text-[10px] font-normal">
              {agent.model}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{agent.description}</p>
        </div>
        <Badge className={cn("shrink-0", badgeToneClassNames[badge.tone])}>
          {badge.label}
        </Badge>
      </div>

      {tasks.length > 0 ? (
        <div className="space-y-2">
          {tasks.map((task) => {
            const expanded = expandedTaskIds.includes(task.taskId);

            return (
              <div key={task.taskId} className="overflow-hidden rounded-lg border bg-muted/35">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex h-auto w-full items-start justify-between gap-3 rounded-none px-3 py-3 text-left"
                  aria-expanded={expanded}
                  onClick={() => toggleTask(task.taskId)}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{task.description}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-normal",
                          task.status === "running"
                            ? badgeToneClassNames.running
                            : task.status === "completed"
                              ? badgeToneClassNames.succeeded
                              : badgeToneClassNames.failed
                        )}
                      >
                        {task.status === "running"
                          ? "Running"
                          : task.status === "completed"
                            ? "Completed"
                            : "Failed"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{getTaskMeta(task)}</p>
                  </div>
                  <ChevronDownIcon
                    className={cn(
                      "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-180"
                    )}
                  />
                </Button>

                {expanded ? (
                  <div className="border-t px-3 py-3">
                    {task.result ? (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                        {task.result}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {task.status === "running"
                          ? "Task is still in progress."
                          : "No additional task details were recorded."}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1 rounded-lg bg-muted/50 p-3">
          <p className="text-sm font-medium">No recent activity</p>
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        </div>
      )}
    </div>
  );
}

export function AgentStatusDrawer({
  apiClient,
  open,
  onOpenChange,
}: AgentStatusDrawerProps) {
  const [agents, setAgents] = useState<AgentStatusInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const nextAgents = await fetchAgentStatuses(apiClient);
      setAgents(nextAgents);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load agent status."
      );
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadAgents();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadAgents, open]);

  const content = useMemo(() => {
    if (loading && agents.length === 0 && !error) {
      return (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Spinner />
          <p>Loading agent status…</p>
        </div>
      );
    }

    if (error && agents.length === 0) {
      return (
        <div
          className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-center"
          role="alert"
        >
          <AlertCircleIcon className="size-5 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Could not load agent status</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAgents()}>
            Retry
          </Button>
        </div>
      );
    }

    if (!loading && agents.length === 0) {
      return (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center">
          <p className="text-sm font-medium text-foreground">No agents found</p>
          <p className="text-sm text-muted-foreground">
            Registered agents will appear here once Max has loaded them.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {error ? (
          <div
            className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-muted-foreground"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {agents.map((agent) => (
          <AgentStatusCard key={agent.slug} agent={agent} />
        ))}
      </div>
    );
  }, [agents, error, loadAgents, loading]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={AGENT_STATUS_DRAWER_DIALOG_CLASS_NAME}>
        <DialogHeader className="border-b px-4 py-4 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle>Agent status</DialogTitle>
              <DialogDescription>
                See what each registered agent is doing right now.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="-mr-1"
              onClick={() => void loadAgents()}
              aria-label="Refresh agent status"
              disabled={loading}
            >
              <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </DialogHeader>

        <div className={AGENT_STATUS_DRAWER_BODY_CLASS_NAME}>{content}</div>
      </DialogContent>
    </Dialog>
  );
}
