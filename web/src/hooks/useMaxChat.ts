import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendSystemMessage as appendSystemMessageToList,
  HYDRATED_MESSAGE_LIMIT,
  loadStoredMessages,
  persistMessages,
} from "@/lib/chat-messages";
import { resolveRestoredMessages } from "@/lib/chat-history";
import { createApiClient } from "@/lib/api-client";
import { createMessageId, type RouteInfo, type UIMessage } from "@/lib/chat-types";
import {
  getReconnectDelay,
  registerAppReactivationListeners,
  shouldReconnectOnReactivation,
  shouldRestoreHistoryOnReactivation,
} from "@/lib/connectivity";
import { openSseStream } from "@/lib/sse";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

type MaxSseEvent =
  | { type: "connected"; connectionId: string }
  | { type: "delta"; content: string }
  | { type: "message"; content: string; route?: RouteInfo }
  | { type: "cancelled" };

export function useMaxChat() {
  const [messages, setMessages] = useState<UIMessage[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    return loadStoredMessages(window.localStorage, HYDRATED_MESSAGE_LIMIT);
  });
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [connected, setConnected] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(() => {
    if (typeof navigator === "undefined") {
      return true;
    }

    return navigator.onLine;
  });
  const [reconnectKey, setReconnectKey] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [restoringHistory, setRestoringHistory] = useState(true);

  const lastActivityAtRef = useRef<number | null>(null);
  const lastReconnectRequestAtRef = useRef(0);
  const messagesRef = useRef(messages);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRequestRef = useRef<Promise<void> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  // Whether the next "message" SSE event is a reply to a user turn
  // (vs. a proactive broadcast from a background task).
  const expectingResponseRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;

    if (typeof window === "undefined") {
      return;
    }

    persistMessages(window.localStorage, messages);
  }, [messages]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current === null) {
      return;
    }

    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const markConnectionActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
  }, []);

  const requestReconnect = useCallback(
    ({ immediate }: { immediate: boolean }) => {
      const online = typeof navigator === "undefined" ? browserOnline : navigator.onLine;
      if (!online) {
        return;
      }

      if (immediate) {
        const now = Date.now();
        if (now - lastReconnectRequestAtRef.current < 1000) {
          return;
        }
        lastReconnectRequestAtRef.current = now;
        reconnectAttemptRef.current = 0;
      }

      clearReconnectTimer();
      connectionIdRef.current = null;
      setConnected(false);
      setReconnecting(true);

      if (immediate) {
        setReconnectKey((current) => current + 1);
        return;
      }

      const attempt = reconnectAttemptRef.current;
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        setReconnectKey((current) => current + 1);
      }, getReconnectDelay(attempt));
    },
    [browserOnline, clearReconnectTimer]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => {
      clearReconnectTimer();
      connectionIdRef.current = null;
      lastActivityAtRef.current = null;
      reconnectAttemptRef.current = 0;
      setBrowserOnline(false);
      setConnected(false);
      setReconnecting(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [clearReconnectTimer]);

  useEffect(
    () => () => {
      clearReconnectTimer();
    },
    [clearReconnectTimer]
  );

  const apiClient = useMemo(() => createApiClient(token), [token]);

  const restoreRecentMessages = useCallback(
    async ({
      reason = "startup",
    }: {
      reason?: "reactivation" | "startup";
    } = {}) => {
      if (
        reason === "reactivation" &&
        !shouldRestoreHistoryOnReactivation({
          cachedMessageCount: messagesRef.current.length,
          lastActivityAt: lastActivityAtRef.current,
          now: Date.now(),
        })
      ) {
        return;
      }

      if (restoreRequestRef.current) {
        return restoreRequestRef.current;
      }

      setRestoringHistory(true);
      const request = (async () => {
        try {
          const restored = await apiClient.get<UIMessage[]>(
            `/history?limit=${HYDRATED_MESSAGE_LIMIT}`
          );

          setMessages((prev) =>
            resolveRestoredMessages({
              cachedMessages: prev,
              historyMessages: restored,
            })
          );
        } catch (err) {
          console.error("[max] history restore failed:", err);
        } finally {
          restoreRequestRef.current = null;
          setRestoringHistory(false);
        }
      })();

      restoreRequestRef.current = request;
      return request;
    },
    [apiClient]
  );

  const handleEvent = useCallback((evt: MaxSseEvent) => {
    if (evt.type === "connected") {
      markConnectionActivity();
      connectionIdRef.current = evt.connectionId;
      reconnectAttemptRef.current = 0;
      setConnected(true);
      setReconnecting(false);
      setStatus("ready");
      return;
    }

    if (evt.type === "delta") {
      setStatus("streaming");
      setMessages((prev) => setAssistantText(prev, evt.content));
      return;
    }

    if (evt.type === "message") {
      const wasExpecting = expectingResponseRef.current;
      expectingResponseRef.current = false;
      setStatus("ready");
      setMessages((prev) => {
        if (!wasExpecting) {
          return [
            ...prev,
            {
              id: createMessageId(),
              role: "assistant",
              text: evt.content,
              route: evt.route,
              proactive: true,
            },
          ];
        }
        return finalizeAssistant(prev, evt.content, evt.route);
      });
      return;
    }

    if (evt.type === "cancelled") {
      expectingResponseRef.current = false;
      setStatus("ready");
    }
  }, [markConnectionActivity]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    return registerAppReactivationListeners({
      document,
      onReactivate: () => {
        void restoreRecentMessages({ reason: "reactivation" });

        if (
          !shouldReconnectOnReactivation({
            browserOnline,
            connected,
            lastActivityAt: lastActivityAtRef.current,
            now: Date.now(),
          })
        ) {
          return;
        }

        requestReconnect({ immediate: true });
      },
      window,
    });
  }, [browserOnline, connected, requestReconnect, restoreRecentMessages]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      void restoreRecentMessages({ reason: "startup" });
    }, 0);

    return () => {
      window.clearTimeout(restoreTimer);
    };
  }, [restoreRecentMessages]);

  useEffect(() => {
    if (!browserOnline) {
      clearReconnectTimer();
      connectionIdRef.current = null;
      lastActivityAtRef.current = null;
      return;
    }

    const abort = new AbortController();

    (async () => {
      try {
        // Try bootstrap for token (works on localhost); LAN clients rely on session cookie.
        try {
          const bootRes = await fetch("/auth/bootstrap", {
            signal: abort.signal,
            credentials: "include",
          });
          if (bootRes.ok) {
            const { token } = (await bootRes.json()) as { token: string };
            tokenRef.current = token;
            setToken(token);
          }
        } catch {
          // Bootstrap not available (LAN) — proceed with cookie-only auth
        }

        const headers: Record<string, string> = { "X-Max-Client": "web" };
        if (tokenRef.current) {
          headers["Authorization"] = `Bearer ${tokenRef.current}`;
        }

        await openSseStream(
          "/stream",
          {
            headers,
            credentials: "include",
          },
          (evt) => {
            let parsed: MaxSseEvent;
            try {
              parsed = JSON.parse(evt.data) as MaxSseEvent;
            } catch {
              return;
            }
            handleEvent(parsed);
          },
          markConnectionActivity,
          abort.signal
        );

        if (abort.signal.aborted) {
          return;
        }

        requestReconnect({ immediate: false });
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error("[max] SSE error:", err);
        connectionIdRef.current = null;
        lastActivityAtRef.current = null;
        setStatus("error");
        setConnected(false);
        requestReconnect({ immediate: false });
      }
    })();

    return () => abort.abort();
  }, [browserOnline, clearReconnectTimer, handleEvent, markConnectionActivity, reconnectKey, requestReconnect]);

  const sendMessage = useCallback(async (text: string) => {
    const connectionId = connectionIdRef.current;
    if (!connectionId) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { id: createMessageId(), role: "user", text: trimmed },
      { id: createMessageId(), role: "assistant", text: "" },
    ]);
    expectingResponseRef.current = true;
    setStatus("submitted");

    try {
      await apiClient.post("/message", { prompt: trimmed, connectionId });
    } catch (err) {
      console.error("[max] send failed:", err);
      expectingResponseRef.current = false;
      setStatus("error");
    }
  }, [apiClient]);

  const cancel = useCallback(async () => {
    try {
      await apiClient.post("/cancel");
    } catch (err) {
      console.error("[max] cancel failed:", err);
    }
  }, [apiClient]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const appendSystemMessage = useCallback((text: string) => {
    setMessages((prev) => appendSystemMessageToList(prev, text));
  }, []);

  return {
    apiClient,
    appendSystemMessage,
    cancel,
    clearMessages,
    browserOnline,
    connected,
    messages,
    reconnecting,
    restoringHistory,
    sendMessage,
    status,
  };
}

function setAssistantText(
  messages: UIMessage[],
  fullText: string
): UIMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return [
      ...messages,
      { id: createMessageId(), role: "assistant", text: fullText },
    ];
  }
  return [
    ...messages.slice(0, -1),
    { ...last, text: fullText },
  ];
}

function finalizeAssistant(
  messages: UIMessage[],
  finalText: string,
  route?: RouteInfo
): UIMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return [
      ...messages,
      { id: createMessageId(), role: "assistant", text: finalText, route },
    ];
  }
  return [
    ...messages.slice(0, -1),
    { ...last, text: finalText, route },
  ];
}
