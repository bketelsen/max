export type AuthProbeResult = "ok" | "auth-expired" | "retry";
export type ConnectionUiState = "online" | "connecting" | "reconnecting" | "offline";
export type ReactivationSource = "visibilitychange" | "pageshow" | "focus";

export type ConnectionUiSnapshot = {
  state: ConnectionUiState;
  label: string;
  ariaLabel: string;
  composerDisabled: boolean;
  composerMessage: string | null;
};

export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
export const CONNECTION_LOST_SUFFIX = " ⚠️ [connection lost]";
export const STALE_CONNECTION_THRESHOLD_MS = 45_000;

type RedirectLikeResponse = Pick<Response, "ok" | "status" | "type">;
type Listener = () => void;
type EventTargetLike = {
  addEventListener: (type: string, listener: Listener) => void;
  removeEventListener: (type: string, listener: Listener) => void;
};
type VisibilityTarget = EventTargetLike & {
  visibilityState?: string;
};

export function classifyAuthRedirectResponse(
  response: RedirectLikeResponse
): AuthProbeResult {
  if (response.ok) {
    return "ok";
  }

  if (
    response.type === "opaqueredirect" ||
    response.status === 0 ||
    response.status === 401 ||
    response.status === 403
  ) {
    return "auth-expired";
  }

  return "retry";
}

export function getReconnectDelay(attempt: number): number {
  return RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 30000;
}

export function appendConnectionLostMarker(text: string): string {
  if (!text || text.endsWith(CONNECTION_LOST_SUFFIX)) {
    return text;
  }

  return `${text}${CONNECTION_LOST_SUFFIX}`;
}

export function registerAppReactivationListeners({
  document,
  onReactivate,
  window,
}: {
  document: VisibilityTarget;
  onReactivate: (source: ReactivationSource) => void;
  window: EventTargetLike;
}): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      return;
    }

    onReactivate("visibilitychange");
  };
  const handlePageShow = () => onReactivate("pageshow");
  const handleFocus = () => onReactivate("focus");

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("focus", handleFocus);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("focus", handleFocus);
  };
}

export function shouldReconnectOnReactivation({
  browserOnline,
  connected,
  lastActivityAt,
  now,
  staleAfterMs = STALE_CONNECTION_THRESHOLD_MS,
}: {
  browserOnline: boolean;
  connected: boolean;
  lastActivityAt: number | null;
  now: number;
  staleAfterMs?: number;
}): boolean {
  if (!browserOnline) {
    return false;
  }

  if (!connected) {
    return true;
  }

  if (lastActivityAt === null) {
    return true;
  }

  return now - lastActivityAt >= staleAfterMs;
}

export function getConnectionUiState({
  browserOnline,
  connected,
  reconnecting = false,
}: {
  browserOnline: boolean;
  connected: boolean;
  reconnecting?: boolean;
}): ConnectionUiSnapshot {
  if (!browserOnline) {
    return {
      ariaLabel: "Offline",
      composerDisabled: true,
      composerMessage:
        "You're offline. Cached messages are still available, but sending is disabled until you're back online.",
      label: "You're offline",
      state: "offline",
    };
  }

  if (reconnecting) {
    return {
      ariaLabel: "Reconnecting",
      composerDisabled: true,
      composerMessage: "Reconnecting to Max. Cached messages stay visible while chat reconnects.",
      label: "Reconnecting",
      state: "reconnecting",
    };
  }

  if (!connected) {
    return {
      ariaLabel: "Connecting",
      composerDisabled: true,
      composerMessage:
        "Connecting to Max. You can keep reading cached messages while chat reconnects.",
      label: "Connecting",
      state: "connecting",
    };
  }

  return {
    ariaLabel: "Connected",
    composerDisabled: false,
    composerMessage: null,
    label: "Online",
    state: "online",
  };
}
