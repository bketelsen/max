import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import type { ApiClient } from "@/lib/api-client";
import { executeSlashCommandInvocation } from "@/lib/slash-command-actions";
import type { SlashCommand, SlashCommandInvocation } from "@/lib/slash-commands";
import {
  filterSlashCommands,
  parseSlashCommandInput,
  parseSlashCommandInvocation,
} from "@/lib/slash-commands";

type SlashCommandContext = {
  apiClient: ApiClient;
  appendSystemMessage: (content: string) => void;
  cancel: () => void | Promise<void>;
  clearMessages: () => void;
  input: string;
  isComposing?: boolean;
  setInput: (value: string) => void;
};

function moveSelection(
  index: number,
  delta: number,
  total: number
): number {
  if (total === 0) {
    return 0;
  }

  return (index + delta + total) % total;
}

function focusTextareaAtEnd() {
  requestAnimationFrame(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLTextAreaElement)) {
      return;
    }

    const end = activeElement.value.length;
    activeElement.setSelectionRange(end, end);
  });
}

export function useSlashCommands({
  apiClient,
  appendSystemMessage,
  cancel,
  clearMessages,
  input,
  isComposing = false,
  setInput,
}: SlashCommandContext) {
  const parsedInput = useMemo(() => parseSlashCommandInput(input), [input]);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const [selectedCommandName, setSelectedCommandName] = useState<string | undefined>(
    undefined
  );

  const commands = useMemo(
    () => filterSlashCommands(parsedInput.search),
    [parsedInput.search]
  );

  const isOpen =
    !isComposing &&
    parsedInput.isOpen &&
    parsedInput.token !== "" &&
    dismissedToken !== parsedInput.token;
  const selectedCommand =
    commands.find((command) => command.name === selectedCommandName) ??
    commands[0];

  const dismiss = useCallback(() => {
    if (parsedInput.token) {
      setDismissedToken(parsedInput.token);
    }
  }, [parsedInput.token]);

  const fillInputCommand = useCallback(
    (command: SlashCommand) => {
      const nextValue = `/${command.name} `;
      setInput(nextValue);
      setDismissedToken(`/${command.name}`);
      setSelectedCommandName(command.name);
      focusTextareaAtEnd();
    },
    [setInput]
  );

  const runInvocation = useCallback(
    async (invocation: SlashCommandInvocation) => {
      await executeSlashCommandInvocation(invocation, {
        apiClient,
        appendSystemMessage,
        cancel,
        clearMessages,
      });
    },
    [apiClient, appendSystemMessage, cancel, clearMessages]
  );

  const executeCommand = useCallback(
    async (command: SlashCommand) => {
      if (command.kind === "input") {
        fillInputCommand(command);
        return;
      }

      try {
        await runInvocation({
          args: "",
          command,
          input: `/${command.name}`,
          token: `/${command.name}`,
        });
        setInput("");
        setDismissedToken(`/${command.name}`);
        setSelectedCommandName(command.name);
      } catch (error) {
        appendSystemMessage(
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    [appendSystemMessage, fillInputCommand, runInvocation, setInput]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen || isComposing || event.nativeEvent.isComposing) {
        return;
      }

      const hasCommands = commands.length > 0;

      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }

      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        if (!hasCommands) {
          return;
        }

        event.preventDefault();
        const currentIndex = selectedCommand
          ? commands.findIndex((command) => command.name === selectedCommand.name)
          : 0;
        const nextCommand = commands[moveSelection(currentIndex, 1, commands.length)];
        setSelectedCommandName(nextCommand?.name);
        return;
      }

      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        if (!hasCommands) {
          return;
        }

        event.preventDefault();
        const currentIndex = selectedCommand
          ? commands.findIndex((command) => command.name === selectedCommand.name)
          : 0;
        const nextCommand = commands[moveSelection(currentIndex, -1, commands.length)];
        setSelectedCommandName(nextCommand?.name);
        return;
      }

      if (event.key === "Enter" && selectedCommand) {
        event.preventDefault();
        void executeCommand(selectedCommand);
      }
    },
    [commands.length, dismiss, executeCommand, isComposing, isOpen, selectedCommand]
  );

  const handleSubmit = useCallback(async () => {
    const invocation = parseSlashCommandInvocation(input);

    if (!invocation) {
      return false;
    }

    try {
      await runInvocation(invocation);
      setDismissedToken(invocation.token);
      setInput("");
      return true;
    } catch (error) {
      appendSystemMessage(
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }, [appendSystemMessage, input, runInvocation, setInput]);

  return {
    commands,
    dismiss,
    executeCommand,
    handleKeyDown,
    handleSubmit,
    isOpen,
    selectedCommandName: selectedCommand?.name,
  };
}
