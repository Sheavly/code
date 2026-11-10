# @sheavly/workspace

A project on disk, for coding UIs: path confinement to the workspace root, the process runner,
per-file locks, workspace trust, the project's `.sheavly/` hooks and the AGENTS.md hook. Only
coding packages and coding UIs depend on it.
Process results retain bounded first/last output lines, with shortened oversized lines and a
30,000-character limit. Original output still reaches pipeline readers and output callbacks.

```ts
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { loadProjectHooks } from '@sheavly/workspace/project-hooks/project-hooks.helper';

const workspace = await Workspace.open(root);
```

## Scratch folder

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

| Module                 | What it holds                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `workspace/`           | `Workspace`: `resolveRead` / `resolveWrite`, confined to the root (not an OS sandbox)       |
| `scratch/`             | The scratch root and folders (owner-checked), `pruneScratch`, the scratch hook              |
| `process/`             | `ProcessRunner`: one process group per command, or a `\|`, `&&`, `\|\|`, `;` line, no shell |
| `file-locks/`          | `FileLocks`: per-file locks so writes to one file never overlap                             |
| `file-reads/`          | `FileReads`: which files each agent has seen, so an edit to one it never read is refused    |
| `trust/`               | `TrustStore`: which workspaces the user trusts, outside every repo                          |
| `project-hooks/`       | `loadProjectHooks`: the `.sheavly/` hooks, only in a trusted workspace                      |
| `agents-md/`           | `createAgentsMdHook`: AGENTS.md files as append-only instruction context                    |
| `instruction-context/` | `appendInstructionContext`: append changed instructions, deduplicated from history          |
| `skills/`              | `findSkills`, `createSkillsHook`, `skillRequest`; mentions and completion for UIs           |
| `errors/`              | `WorkspaceError`, `PathCheckError`, the process, trust and hook errors                      |
| `testing/`             | Fakes for tests: `useTempWorkspace`, `useFileLocks`, `testProcesses`                        |

## Docs

- [AGENTS.md](docs/agents-md.md): which files the hook reads, and when.
- [Skills](docs/skills.md): the skill format, where skills are found, and which one wins.
- [Project hooks](docs/project-hooks.md): writing `.sheavly/` hooks, loading them, and workspace
  trust.
