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

## Sibling git worktrees

When the root is in a git repo, the other worktrees of that repo (`git worktree list`) are inside
the workspace too, so a session in the main checkout can work on an issue's worktree. A root in a
sub-folder reaches the same sub-folder of each worktree. Worktrees are listed once per call, only
when a path falls outside the root, and never kept between calls, so one added or removed
mid-session applies at once.
Symlinks and `..` are resolved first, so a path that leads out of every worktree is still refused.
Without git, or outside a repo, the workspace keeps its single root. `run_command` takes a `cwd`
that goes through the same check.

Only apps turn this on: `Workspace.open(root, { env })` takes the app's environment, and without
it the root is the only one. Git's list is not trusted on its own, because a repo's contents can
forge it: a worktree counts only when its `.git` file and the repo's `.git/worktrees/<id>/gitdir`
point at each other. That shows the two files agree, not that they are authentic; forging both
takes write access inside `.git`, which the file tools refuse, or a command the user approved.
Known limits: a submodule or bare repo has no siblings (it fails closed), and an approved
`git worktree add <path>` makes `<path>` reachable for the rest of the session, which is why the
approval for it says so. A path `resolveRead` accepted is in the root, in scratch (`inScratch`) or
in a verified sibling, so `run_command` treats a verified sibling like the root: the shared mode
and allow list apply, including grants given for the root. Those grants then cover a checkout that
may come from another branch, which is the cost of sharing one list. A command that runs in the
scratch folder always asks, naming the folder, and the answer is never kept as a grant (`allow_all`
asks nothing, as everywhere). `.git` of a sibling worktree can't be read or written either.

`findMainRoot({ root, env })` gives the folder `root` has in the repo's main worktree, so per-folder
settings (the backend's command permissions) are shared by every worktree of a repo. It uses the
same verification, and returns `root` itself when it is in no repo, its link does not verify, the
folder is missing from the main worktree, or the main worktree holds it as a symlink to another
folder.

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
