import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "@/components/ai-elements/prompt-input";
import type { SlashCommand } from "@/lib/slash-commands";
import { cn } from "@/lib/utils";

export interface SlashCommandPopupProps {
  commands: SlashCommand[];
  isOpen: boolean;
  selectedCommandName?: string;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandPopup({
  commands,
  isOpen,
  selectedCommandName,
  onSelect,
}: SlashCommandPopupProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2">
      <PromptInputCommand
        className="max-h-[min(18rem,40dvh)] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-popover/85"
        loop
        shouldFilter={false}
        value={selectedCommandName}
      >
        <PromptInputCommandList className="max-h-[min(18rem,40dvh)]">
          <PromptInputCommandEmpty className="px-3 py-4 text-left text-sm text-muted-foreground">
            No matching commands.
          </PromptInputCommandEmpty>
          <PromptInputCommandGroup heading="Slash commands">
            {commands.map((command) => (
              <PromptInputCommandItem
                key={command.name}
                className="items-start gap-3 rounded-xl px-3 py-3"
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => onSelect(command)}
                value={command.name}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      /{command.name}
                    </span>
                    {command.args ? (
                      <span className="text-xs text-muted-foreground">
                        {command.args}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
                        command.kind === "action"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      )}
                    >
                      {command.kind}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {command.description}
                  </p>
                  {command.aliases?.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Aliases:{" "}
                      {command.aliases.map((alias, index) => (
                        <span key={alias}>
                          {index > 0 ? ", " : ""}
                          /{alias}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              </PromptInputCommandItem>
            ))}
          </PromptInputCommandGroup>
        </PromptInputCommandList>
      </PromptInputCommand>
    </div>
  );
}
