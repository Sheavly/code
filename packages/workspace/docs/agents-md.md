# AGENTS.md

`createAgentsMdHook` reads a project's AGENTS.md files and appends them as instruction context. A UI includes it; the terminal app puts it first, before the `.sheavly` hooks.

## The hook

`createAgentsMdHook({ root, cwd? })` (`@sheavly/workspace/agents-md/`) is a `beforeTurn` hook that
reads AGENTS.md files and appends changed instructions to history.

- It looks in every folder from `root` down to `cwd` (default: `root`), like git walks up from
  the working directory, and never above `root`. Files go root first, each under its path, so
  the more specific one comes last and wins.
- It re-reads them every turn, so an edit (even the agent's own) applies on the next model call.
- It keeps earlier context unchanged, and appends only when the instructions change, including
  when files are removed. Deduplication reads history, so reopening and sub-agents work without
  shared mutable hook state. This keeps Claude's signed conversation prefix intact.
- It includes all applicable instructions without a character cap. Empty files are skipped and
  surrounding whitespace is trimmed. The model's context-window limit still applies.
