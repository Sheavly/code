# @sheavly/workspace

A project on disk, for coding UIs: path confinement to the workspace root, working roots, file reads and the shared scratch folder. Only coding packages and
coding UIs depend on it. The process runner lives in `@sheavly/process` ([README](../process/README.md)). What a coding run does with
the project (workspace trust, the `.sheavly/` hooks, AGENTS.md and skills) is the coding extension's
([`@sheavly/coding`](../../extensions/coding/README.md)).

```ts
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';

const workspace = await Workspace.open(root);
```

## Scratch folder

`Workspace.open(root, { scratchRoot })` also lets the file tools use one shared folder outside the
repo, with an owner-checked folder per agent (`workspace.scratchDir(agentId)`) and `pruneScratch`
to remove stale entries. See [the scratch folder](docs/scratch.md).

## Sibling git worktrees

When the root is in a git repo, the other worktrees of that repo (`git worktree list`) are inside
the workspace too, so a session in the main checkout can work on an issue's worktree. Only apps
turn this on (`Workspace.open(root, { env })`), and a worktree counts only once its `.git` file and
the repo's `.git/worktrees/<id>/gitdir` point at each other. `findMainRoot({ root, env })` gives
the folder `root` has in the repo's main worktree. See [sibling worktrees](docs/worktrees.md).

| Module                 | What it holds                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace/`           | `Workspace`: `resolveRead` / `resolveWrite` / `resolveDelete`, confined to the root (not an OS sandbox)                                     |
| `scratch/`             | The scratch root and folders (owner-checked), `pruneScratch`, the scratch hook                                                              |
| `working-root/`        | `WorkingRoots`: the folder a conversation's agents work from, kept in a core `DocumentStore` (`shell.json`); `anchorToRoot`, `showFromRoot` |
| `file-reads/`          | `FileReads`: which files each agent has seen, by hash; kept in `shell.json` and restored on reopen                                          |
| `instruction-context/` | What names the instruction sources: `INSTRUCTION_ORDER`, the size cap, and `readConfinedFile`. The factory is core's                        |
| `errors/`              | `WorkspaceError`, `PathCheckError`                                                                                                          |
| `testing/`             | Fakes for tests: `useTempWorkspace`, `useFileReads`, `useTempRepo`, `testWorkingRoots`                                                      |

## Instruction rendering

Authored model guidance for the scratch folder lives in the adjacent internal `scratch.prompt.ts`
renderer; the AGENTS.md and skills renderers are the coding extension's. Prompt renderers perform
no I/O or state changes. The hook factory, the history lookup/deduplication and the
`<instruction-context>` renderer are `@sheavly/core`'s (`instruction-context/`).

## Docs

- [Scratch folder](docs/scratch.md): the shared folder outside the repo, its checks and pruning.
- [Sibling git worktrees](docs/worktrees.md): how worktrees of a repo count as inside the
  workspace, and what that means for commands.

The coding policy built on this package (workspace trust, `.sheavly/` hooks, AGENTS.md and skills)
is in the [coding extension's docs](../../extensions/coding/README.md#docs).
