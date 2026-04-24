import { useCallback, useEffect, useRef, useState } from "react";
import { openSseStream } from "@/lib/sse";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type RouteInfo = {
  model: string;
  tier?: string | null;
  routerMode: "auto" | "manual";
  overrideName?: string;
};

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  route?: RouteInfo;
  proactive?: boolean;
};

type MaxSseEvent =
  | { type: "connected"; connectionId: string }
  | { type: "delta"; content: string }
  | { type: "message"; content: string; route?: RouteInfo }
  | { type: "cancelled" };

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useMaxChat() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [connected, setConnected] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  // Whether the next "message" SSE event is a reply to a user turn
  // (vs. a proactive broadcast from a background task).
  const expectingResponseRef = useRef(false);

  useEffect(() => {
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
          abort.signal
        );
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error("[max] SSE error:", err);
        setStatus("error");
        setConnected(false);
      }
    })();

    return () => abort.abort();
  }, []);

  function handleEvent(evt: MaxSseEvent) {
    if (evt.type === "connected") {
      connectionIdRef.current = evt.connectionId;
      setConnected(true);
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
              id: newId(),
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
      return;
    }
  }

  const sendMessage = useCallback(async (text: string) => {
    const connectionId = connectionIdRef.current;
    if (!connectionId) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", text: trimmed },
      { id: newId(), role: "assistant", text: "" },
    ]);
    expectingResponseRef.current = true;
    setStatus("submitted");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Max-Client": "web",
      };
      if (tokenRef.current) {
        headers["Authorization"] = `Bearer ${tokenRef.current}`;
      }
      const res = await fetch("/message", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ prompt: trimmed, connectionId }),
      });
      if (!res.ok) {
        throw new Error(`/message failed: ${res.status}`);
      }
    } catch (err) {
      console.error("[max] send failed:", err);
      expectingResponseRef.current = false;
      setStatus("error");
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      const headers: Record<string, string> = { "X-Max-Client": "web" };
      if (tokenRef.current) {
        headers["Authorization"] = `Bearer ${tokenRef.current}`;
      }
      await fetch("/cancel", {
        method: "POST",
        headers,
        credentials: "include",
      });
    } catch (err) {
      console.error("[max] cancel failed:", err);
    }
  }, []);

  return { messages, status, connected, sendMessage, cancel };
}

function setAssistantText(
  messages: UIMessage[],
  fullText: string
): UIMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return [
      ...messages,
      { id: newId(), role: "assistant", text: fullText },
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
      { id: newId(), role: "assistant", text: finalText, route },
    ];
  }
  return [
    ...messages.slice(0, -1),
    { ...last, text: finalText, route },
  ];
}
