# @sheavly/coding

The coding tools and the services a coding run shares. `createCodingHarness` opens the workspace
and makes one set of file locks and one process runner on top of `createHarness`; the tools are
built on those. It adds no tools or hooks to a run itself: a coding UI picks which ones a run gets.

```ts
import { createCodingHarness } from '@sheavly/coding/preset/coding.helper';
import { createReadFileTool } from '@sheavly/coding/read-file/read-file.tool';

const harness = await createCodingHarness({ provider, title, workspaceRoot, env: process.env });
const tools = [createReadFileTool({ workspace: harness.workspace })];
```

| Module         | What it holds                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `preset/`      | `createCodingHarness`: the workspace, `fileLocks` and `processes` a run shares                  |
| `read-file/`   | `read_file`, and the `FileRead` artifact with its `isFileRead` guard                            |
| `read-skill/`  | `read_skill`: a skill's SKILL.md or a file in its folder, from the project's or the user's      |
| `write-file/`  | `write_file`                                                                                    |
| `edit-file/`   | `edit_file`                                                                                     |
| `run-command/` | `run_command`: the user's permissions, argument checks, safe git config, approvals              |
| `files/`       | What the file tools share: `resolveWritable`, the `.env` guard, `FileChange` and `isFileChange` |
| `errors/`      | `CommandRefusedError`: a command needed approval nobody gave, or the user skipped it            |

## Docs

- [File tools](docs/file-tools.md): confinement, the three tools, and the artifacts they return.
- [Skills](../workspace/docs/skills.md): `read_skill`, and where the skills it reads come from.
- [run_command](docs/run-command.md): how a command is checked before it runs.
