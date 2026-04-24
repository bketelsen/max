# Copilot Instructions for Max

## Tool Naming

**Do NOT create tools that share a name with built-in Copilot CLI tools.** Copilot CLI reserves certain tool names (e.g. `list_agents`, `read_agent`, `write_agent`, `task`, `bash`, `grep`, `glob`, `view`, `edit`, `create`, etc.). If Max defines a tool with the same name, it will conflict at runtime.

When naming custom tools, use unique prefixes or alternative verbs to avoid collisions. For example:
- ~~`list_agents`~~ → `show_agent_roster`
- ~~`read_agent`~~ → `get_agent_result` (already done)

If you encounter a "conflicts with built-in tool" error, rename the offending tool and update all references in `src/copilot/tools.ts`, `src/copilot/agents.ts`, and `src/copilot/system-message.ts`.

## Memory (COG) — do not reintroduce memory tools

Max's memory is [COG](https://github.com/marciopuga/cog), a filesystem-resident tree at `~/.max/cog/`. The orchestrator and agents read and write memory using Copilot CLI's built-in `Read`, `Write`, `Edit`, `Glob`, and `Grep` tools — **there are no custom memory tools** (no `remember`, `recall`, `forget`, `wiki_*`, etc.).

Do not add wrappers like `save_memory` or `read_memory`. The COG skill files in `skills/cog-*/` and the system prompt in `~/.max/cog/SYSTEM.md` (bundled default at `src/cog/default-system.md`) teach the model the memory rules (SSOT, append-only observations, L0/L1/L2 retrieval, wiki-links). When those rules need to evolve, edit the bundled SYSTEM.md or the skill files — not `src/copilot/tools.ts`.

If you change a bundled skill or the system prompt, `src/cog/fingerprint.ts` auto-invalidates the persisted orchestrator session on next daemon start so the new content actually lands in `<available_skills>`. (Copilot SDK bakes the skill list in at session-create time, not on resume.)

## Pipeline skills and the CLI

`max reflect`, `max housekeeping`, and `max evolve` are thin wrappers over `POST /cog/trigger` (see `src/cog/cli-client.ts`). The systemd timers installed by `max service install-*` invoke these CLI commands, which then dispatch the matching `cog-*` skill through the running daemon's orchestrator. Don't add standalone Copilot sessions for these — the single-session model is the invariant.
