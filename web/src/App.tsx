import { useCallback, useEffect, useRef, useState } from "react";
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
  PromptInputProvider,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { SlashCommandPopup } from "@/components/slash-command-popup";
import { AgentStatusDrawer } from "@/components/agent-status-drawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useMaxChat } from "@/hooks/useMaxChat";
import { useAuth } from "@/hooks/useAuth";
import { LoginPage } from "@/components/auth/login-page";
import { SetupPage, SetupRequiredPage } from "@/components/auth/setup-page";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { type RouteInfo, type UIMessage } from "@/lib/chat-types";
import { getConnectionUiState } from "@/lib/connectivity";
import { cn } from "@/lib/utils";

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

function SystemMessage({ m }: { m: UIMessage }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full rounded-xl border border-border/70 bg-muted/35 px-4 py-3 text-muted-foreground">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px] font-normal">
            System
          </Badge>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm">
          {m.text}
        </pre>
      </MessageContent>
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
  const [agentStatusOpen, setAgentStatusOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const {
    apiClient,
    appendSystemMessage,
    browserOnline,
    messages,
    status,
    connected,
    reconnecting,
    restoringHistory,
    sendMessage,
    clearMessages,
    cancel,
  } = useMaxChat();
  const connectionUi = getConnectionUiState({ browserOnline, connected, reconnecting });

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
              className={cn(
                "inline-block size-2 rounded-full",
                connectionUi.state === "online" ? "bg-emerald-500" : "bg-amber-500"
              )}
              aria-label={connectionUi.ariaLabel}
            />
            <span className="text-xs text-muted-foreground">{connectionUi.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAgentStatusOpen((currentOpen) => !currentOpen)}
            >
              Agents
            </Button>
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
              restoringHistory ? (
                <ConversationEmptyState
                  title="Loading recent messages…"
                  description="Restoring your latest chat history."
                />
              ) : (
                <ConversationEmptyState
                  title="What's on your mind?"
                  description="Send a message to start."
                />
              )
            ) : (
              messages.map((m) =>
                m.role === "user" ? (
                  <Message from="user" key={m.id}>
                    <MessageContent>{m.text}</MessageContent>
                  </Message>
                ) : m.role === "system" ? (
                  <SystemMessage key={m.id} m={m} />
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
            <PromptInputProvider>
              <ChatComposer
                apiClient={apiClient}
                appendSystemMessage={appendSystemMessage}
                cancel={cancel}
                clearMessages={clearMessages}
                composerDisabled={connectionUi.composerDisabled}
                composerMessage={connectionUi.composerMessage}
                sendMessage={sendMessage}
                status={status}
              />
            </PromptInputProvider>
          </div>
        </div>

        <AgentStatusDrawer
          apiClient={apiClient}
          open={agentStatusOpen}
          onOpenChange={setAgentStatusOpen}
        />
      </div>
    </TooltipProvider>
  );
}

function ChatComposer({
  apiClient,
  appendSystemMessage,
  cancel,
  clearMessages,
  composerDisabled,
  composerMessage,
  sendMessage,
  status,
}: Pick<
  ReturnType<typeof useMaxChat>,
  "apiClient" | "appendSystemMessage" | "cancel" | "clearMessages" | "sendMessage" | "status"
> & {
  composerDisabled: boolean;
  composerMessage: string | null;
}) {
  const controller = usePromptInputController();
  const [isComposing, setIsComposing] = useState(false);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const input = controller.textInput.value;

  const slashCommands = useSlashCommands({
    apiClient,
    appendSystemMessage,
    cancel,
    clearMessages,
    input,
    isComposing,
    setInput: controller.textInput.setInput,
  });

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text?.trim();
      if (!text) {
        return;
      }

      const handled = await slashCommands.handleSubmit();
      if (!handled) {
        await sendMessage(text);
      }
    },
    [sendMessage, slashCommands]
  );

  useEffect(() => {
    if (!slashCommands.isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (composerRef.current?.contains(event.target as Node)) {
        return;
      }

      slashCommands.dismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [slashCommands]);

  return (
    <div
      className={cn("relative")}
      ref={composerRef}
      onCompositionEndCapture={() => setIsComposing(false)}
      onCompositionStartCapture={() => setIsComposing(true)}
    >
      <SlashCommandPopup
        commands={slashCommands.commands}
        isOpen={slashCommands.isOpen}
        onSelect={(command) => void slashCommands.executeCommand(command)}
        selectedCommandName={slashCommands.selectedCommandName}
      />
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            disabled={composerDisabled}
            placeholder={composerDisabled ? connectionPlaceholder(composerMessage) : "Ask Max…"}
            autoComplete="off"
            autoCorrect="on"
            enterKeyHint="send"
            onKeyDown={slashCommands.handleKeyDown}
            spellCheck
          />
        </PromptInputBody>
        <PromptInputFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {composerMessage ?? "Messages are ready to send."}
            </div>
            <PromptInputSubmit disabled={composerDisabled} status={status} onStop={cancel} />
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function connectionPlaceholder(message: string | null): string {
  if (message?.startsWith("You're offline")) {
    return "Offline read-only mode";
  }

  return "Connecting to Max…";
}
