# AGENTS.md

`agentsMdSource` reads a project's AGENTS.md files and appends them as instruction context. A UI builds its hook with `createInstructionHook` and registers it with `registerInstructionHooks`; the backend puts it first, before the `.sheavly` hooks.

## The source

`agentsMdSource({ root, cwd?, workingRoots? })` (`@sheavly/coding/agents-md/`) is an
`InstructionSource`: `createInstructionHook` (`@sheavly/core`) makes a `beforeTurn` hook of it that
reads AGENTS.md files and appends changed instructions to history. The source hands the factory
its working roots through `usableWorkingRoot` (`working-root/`), so a root that went bad is none.

- It looks in every folder from `root` down to `cwd` (default: `root`), like git walks up from
  the working directory, and never above `root`. Files go root first, each under its path, so
  the more specific one comes last and wins.
- It re-reads them every turn, so an edit (even the agent's own) applies on the next model call.
- It keeps earlier context unchanged, and appends only when the instructions change, including
  when files are removed. Deduplication reads history, so reopening and sub-agents work without
  shared mutable hook state. This keeps Claude's signed conversation prefix intact.
- With `workingRoots` (the backend passes the conversation's), the working root is read each
  turn and replaces `cwd`. Inside `root` it narrows the search; outside it (a sibling worktree)
  it is its own project root, because `agentsDirs` refuses a folder outside `root`. A root that
  went bad counts as unset, and the file tools tell the agent so.
- Each file is read through its real path. An AGENTS.md that resolves outside `root`, or to a
  `.env*` file, is skipped, because the working root is chosen by the agent and a symlink there
  would put a foreign file or a secret in the model's context. A symlink that stays inside `root`
  is followed. The read is `readConfinedFile` (`@sheavly/workspace`'s
  `instruction-context/confined-read.helper.ts`): it
  opens the checked real path without following a final link and without blocking (a FIFO is
  skipped), reads only a regular file, then resolves the real path again and drops the text unless
  it is unchanged. A swap between the check and the read is therefore refused, not read. It does
  not go through `Workspace`, whose `resolveRead` does not return an open file.
- It includes all applicable instructions without a character cap. Empty files are skipped and
  surrounding whitespace is trimmed. The model's context-window limit still applies.

## Decisions

- **After a summary:** instruction state is not cleared. The hook compares with the last
  `<instruction-context>` entry still in the history it is given, so when a summary or masking
  drops that entry the next turn announces the instructions again. This costs one repeat and can
  never leave the model without them; pinned in core's `instruction-source.helper.test.ts`.
- **Glob and grep:** they read no AGENTS.md and apply no AGENTS.md scope. They search from the
  working root through the workspace, so the two only agree about where the agent is, not about
  which instructions apply.
