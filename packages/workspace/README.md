# @sheavly/workspace

A project on disk, for coding UIs: path confinement to the workspace root, the process runner,
per-file locks, workspace trust, the project's `.sheavly/` hooks and the AGENTS.md hook. Only
coding packages and coding UIs depend on it.

```ts
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { loadProjectHooks } from '@sheavly/workspace/project-hooks/project-hooks.helper';

const workspace = await Workspace.open(root);
```

| Module                 | What it holds                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `workspace/`           | `Workspace`: `resolveRead` / `resolveWrite`, confined to the root (not an OS sandbox)       |
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
