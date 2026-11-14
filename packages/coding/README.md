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

Pass `scratchRoot` (an absolute folder the app picks, e.g. `<tmpdir>/sheavly`) to let the file
tools also use a shared scratch folder outside the repo; see
[file tools](docs/file-tools.md) and `@sheavly/workspace`.

| Module          | What it holds                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `preset/`       | `createCodingHarness`: the workspace, `fileLocks` and `processes` a run shares                    |
| `instructions/` | `CODING_INSTRUCTIONS`: coding guidance inserted before host extras                                |
| `read-file/`    | `read_file`, and the `FileRead` artifact with its `isFileRead` guard                              |
| `grep/`         | `grep`: ripgrep search of the workspace, and the `GrepResult` artifact with its guard             |
| `glob/`         | `glob`: files matching a pattern, newest first, and the `GlobResult` artifact with its guard      |
| `read-skill/`   | `read_skill`: a skill's SKILL.md or a file in its folder, from the project's or the user's        |
| `write-file/`   | `write_file`                                                                                      |
| `edit-file/`    | `edit_file`                                                                                       |
| `delete-file/`  | `delete_file`: removes one file, through the workspace and the file lock                          |
| `run-command/`  | `run_command`: base-command permissions, safe git config, approvals                               |
| `trail/`        | `fileTrail`: one short line per file-tool or `run_command` call, for a summary's trail            |
| `working-root/` | `set_working_root` and the hook that tells the agent its root each turn                           |
| `files/`        | What the file tools share: `resolveWritable` / `resolveDeletable`, the `.env` guard, `FileChange` |
| `errors/`       | `CommandRefusedError`: a command needed approval nobody gave, or the user skipped it              |

## Docs

`run_command` starts required finite work with `background: true`: the loop keeps the prompt alive
until its result is delivered. Persistent servers and watchers use the `start_service` tool
instead, which has the same checks and approval. The agent can finish independent work, then yield without polling task status.
The generic `await_tasks({ ids, reason })` tool can group results for delivery together; its reason
preserves the dependent decision or next step for the agent after a summary.

With `outputs` (the conversation's `OutputStore`), `run_command` keeps every command's complete
captured stdout and stderr, foreground or background, independent of the bounded preview. Output
printed before a failure, timeout or cancellation stays readable, and a running service's log can be
read as it grows. The result carries `output_ref=<id>`, the bytes stored and whether the log is
`complete`, `capturing` or `INCOMPLETE`. When the preview is shorter than the log, the result also
tells the model to use `read_output` or `search_output` instead of rerunning the command. Pipeline
stdin gets the original bytes; stdout routed into a pipe is not duplicated in the log, only what the
last stage and every stderr print. If storage cannot start a capture the command still runs and the
result says the full output is not being stored; a storage failure mid-capture marks the log
incomplete, never complete. Without `outputs` only the preview exists, as before.

The preset returns `instructions`: generic core, coding guidance, then caller extras. Its inherited
`baseInstructions` option replaces only the generic core, not coding guidance. Conversations use
this text by default; direct loop callers pass it explicitly. See
[instruction composition](../host/docs/harness.md#instruction-composition).
Coding guidance excludes routine investigation of secret-bearing files and forbids probing or
bypassing protected-file rules. Tool guards still enforce those rules independently.
The coding section is a short reminder to inspect first, fit the surrounding code, preserve
existing work and verify changed behavior; detailed procedures stay in tools and project instructions.
Its source is the internal `src/instructions/coding-instructions.prompt.ts`. Each tool's adjacent
`*.prompt.ts` owns its model-facing description and input guidance, plus instructional output notes.
These prompt modules are internal; schema validation, runtime effects and UI artifacts stay in code.
The public `CODING_INSTRUCTIONS` constant remains at its existing constants subpath as a direct,
typed alias, preserving both its value and literal type without duplicating the authored text.

- [File tools](docs/file-tools.md): confinement, the four tools, the artifacts they return, and
  the [working root](docs/file-tools.md#the-working-root) an agent can set for a worktree.
- [Skills](../workspace/docs/skills.md): `read_skill` returns complete skill files without line or
  character caps, while preserving path confinement and `.env` protection. Ordinary `read_file`
  limits are unchanged.
- [run_command](docs/run-command.md): how a command is checked before it runs.
