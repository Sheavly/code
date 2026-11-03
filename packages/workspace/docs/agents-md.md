# AGENTS.md

`createAgentsMdHook` reads a project's AGENTS.md files and adds them to each model call as system instructions. A UI includes it; the terminal app puts it first, before the `.sheavly` hooks.

## The hook

`createAgentsMdHook({ root, cwd? })` (`@sheavly/workspace/agents-md/`) is a `beforeTurn` hook that
reads AGENTS.md files and adds them as system instructions.

- It looks in every folder from `root` down to `cwd` (default: `root`), like git walks up from
  the working directory, and never above `root`. Files go root first, each under its path, so
  the more specific one comes last and wins.
- It re-reads them every turn, so an edit (even the agent's own) applies on the next model call.
- It caps the total at 32,000 characters, with a truncation note. Empty files are skipped.
