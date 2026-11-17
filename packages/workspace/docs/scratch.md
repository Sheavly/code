# Scratch folder

`Workspace.open(root, { scratchRoot })` also lets the file tools use one shared folder outside the
repo (the app picks it, e.g. `<tmpdir>/sheavly`; created with mode `0700`). The root and each
agent folder must be a real directory (never a symlink) owned by the current user and not writable
by group or others, or opening it throws `WorkspaceError`. Each top-level agent gets
`workspace.scratchDir(agentId)`; sub-agents use their root agent's id. The whole scratch root is
readable and writable by every agent, across conversations and workspaces, by design: it holds no
secrets and what is found there is untrusted input. The per-agent folder is a hand-off convention. The rest
of the filesystem stays out of reach, symlinks are still checked, and `.env*` stays banned. Files
in scratch are shown by absolute path; relative paths still resolve against the workspace root.
`run_command` does not check paths and is unaffected. `pruneScratch({ root, maxAgeMs })` removes
entries older than 14 days (an agent folder only once everything in it is stale), never follows
symlinks, never deletes the root, refuses a root that fails the same ownership check, and throws
`ScratchPruneError` for entries it could not remove. The backend prunes once at startup, so a
folder written to while it is being removed can be lost.
