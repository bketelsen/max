import { useCallback, useState } from "react";
import { CopyIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMaxChat, type RouteInfo, type UIMessage } from "@/hooks/useMaxChat";
import { useAuth } from "@/hooks/useAuth";
import { LoginPage } from "@/components/auth/login-page";
import { SetupPage, SetupRequiredPage } from "@/components/auth/setup-page";

function RouteBadge({ route }: { route: RouteInfo }) {
  const shortModel = route.model.replace(/^claude-/, "");
  const label =
    route.routerMode === "auto" && route.tier
      ? `${shortModel} · ${route.tier}`
      : route.overrideName
        ? `${shortModel} · ${route.overrideName}`
        : shortModel;
  return (
    <Badge variant="outline" className="text-[10px] font-normal">
      {label}
    </Badge>
  );
}

function AssistantMessage({
  m,
  copy,
}: {
  m: UIMessage;
  copy: (text: string) => void;
}) {
  return (
    <Message from="assistant">
      <MessageContent>
        {m.text ? (
          <MessageResponse>{m.text}</MessageResponse>
        ) : (
          <span className="text-muted-foreground text-sm">Thinking…</span>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {m.proactive && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              Proactive
            </Badge>
          )}
          {m.route && <RouteBadge route={m.route} />}
        </div>
      </MessageContent>
      {m.text && (
        <MessageActions>
          <MessageAction
            label="Copy response"
            aria-label="Copy response"
            onClick={() => copy(m.text)}
          >
            <CopyIcon className="size-3" />
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
}

export default function App() {
  const auth = useAuth();

  // Loading state
  if (auth.loading || !auth.status) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-foreground">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  const { status } = auth;

  // Auth not configured + not localhost → tell user to set up from localhost
  if (!status.configured && !status.localhost) {
    return <SetupRequiredPage />;
  }

  // Localhost + not configured (or configured) → show setup page if user navigates to it
  // For localhost we also show the main app since auth is bypassed
  // Not authenticated + not localhost → show login page
  if (!status.authenticated && !status.localhost) {
    return (
      <LoginPage
        methods={status.methods}
        loginTotp={auth.loginTotp}
        loginPasskey={auth.loginPasskey}
        error={auth.error}
      />
    );
  }

  // Authenticated or localhost → show main app (with optional setup access on localhost)
  return <MainApp auth={auth} />;
}

function MainApp({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [showSetup, setShowSetup] = useState(false);
  const { messages, status, connected, sendMessage, cancel } = useMaxChat();

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text?.trim();
      if (!text) return;
      void sendMessage(text);
    },
    [sendMessage]
  );

  const handleCopy = useCallback((text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }, []);

  if (showSetup && auth.status?.localhost) {
    return (
      <div>
        <div className="flex items-center justify-between border-b px-4 py-3 md:px-6 bg-background">
          <h1 className="text-base font-semibold">Max — Auth Setup</h1>
          <button
            type="button"
            onClick={() => setShowSetup(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to chat
          </button>
        </div>
        <SetupPage
          setupTotp={auth.setupTotp}
          removeTotp={auth.removeTotp}
          registerPasskey={auth.registerPasskey}
          listPasskeys={auth.listPasskeys}
          deletePasskey={auth.deletePasskey}
          methods={auth.status.methods}
          error={auth.error}
        />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        className="flex h-dvh flex-col bg-background text-foreground"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold">Max</h1>
            <span
              className={
                "inline-block size-2 rounded-full " +
                (connected ? "bg-emerald-500" : "bg-amber-500")
              }
              aria-label={connected ? "Connected" : "Connecting"}
            />
          </div>
          <div className="flex items-center gap-2">
            {auth.status?.localhost && (
              <button
                type="button"
                onClick={() => setShowSetup(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Auth Setup
              </button>
            )}
            {auth.status?.authenticated && !auth.status?.localhost && (
              <button
                type="button"
                onClick={auth.logout}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="mx-auto w-full max-w-3xl px-3 md:px-6">
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="What's on your mind?"
                description="Send a message to start."
              />
            ) : (
              messages.map((m) =>
                m.role === "user" ? (
                  <Message from="user" key={m.id}>
                    <MessageContent>{m.text}</MessageContent>
                  </Message>
                ) : (
                  <AssistantMessage key={m.id} m={m} copy={handleCopy} />
                )
              )
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 border-t bg-background">
          <div className="mx-auto w-full max-w-3xl p-3 md:p-4">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputBody>
                <PromptInputTextarea
                  placeholder="Ask Max…"
                  autoComplete="off"
                  autoCorrect="on"
                  spellCheck
                  enterKeyHint="send"
                />
              </PromptInputBody>
              <PromptInputFooter>
                <div className="ml-auto">
                  <PromptInputSubmit status={status} onStop={cancel} />
                </div>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
