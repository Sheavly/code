# @sheavly/coding

Coding as an extension (see [the extensions guide](../../.agents/skills/sheavly/extensions.md)):
the coding tools and the services a coding run shares. `createCodingHarness` opens the workspace
and makes one set of file locks and one process runner (`@sheavly/process`) on top of `createHarness`; the tools are
built on those. `createCodingExtension` contributes the file tools, `read_skill`, `run_command`,
the AGENTS.md, skills, scratch and working-root hooks and the workspace's `.sheavly/` hooks, and
shares them with sub-agents through `@sheavly/agents`. Its `sheavly.json` declares those tools and
hooks, the `sub-agents` service it requires, `output-capture` it may read (with the
`output:capture` grant) and `coding-run` it provides.
The user chooses the names of a workspace's own `.sheavly/` hooks, so the manifest declares hooks
with the bare wildcard `*` (the `@sheavly/extension` manifest doc explains wildcards). A coding UI composes it in an
`ExtensionHost` (`@sheavly/extension`) with the other extensions it wants.

```ts
import { createCodingHarness } from '@sheavly/coding/preset/coding.helper';
import { createCodingExtension } from '@sheavly/coding/extension/coding-extension.helper';

const harness = await createCodingHarness({ provider, title, workspaceRoot, env: process.env });
const coding = createCodingExtension({ harness, env: process.env, permissions, trustStore, shell });
```

The extension reads `OUTPUT_CAPTURE`, when supplied, from the run services
(`@sheavly/host/run-services/run-services.utils`) like any extension; the host that activates it
supplies them with `runServices`. The one exception to "no more access than a third party" is
`harness`: coding's workspace, file locks and process runner come from the `CodingHarness` it is
given, which also carries the run state (sessions, tasks, approvals) because `createCodingHarness`
is built on `createHarness`. Its other options are the app's choices: `env` (its own, for working
root and home resolution; the run services carry no environment), `permissions`, `home`,
`trustStore`, `trustWorkspace`, `shell` and `onFileReadsProblem`. `createCodingHarness` takes its
own `env` too.

Pass `scratchRoot` (an absolute folder the app picks, e.g. `<tmpdir>/sheavly`) to let the file
tools also use a shared scratch folder outside the repo; see
[file tools](docs/file-tools.md) and `@sheavly/workspace`.

| Module           | What it holds                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `preset/`        | `createCodingHarness`: the workspace, `fileLocks` and `processes` a run shares                    |
| `extension/`     | `createCodingExtension`, `CODING_RUN`, `CODING_HOOK_NAMES`: coding as an extension of a run       |
| `file-reads/`    | `keepReadsWithConversation`: restores and keeps what the main agent read with its conversation    |
| `instructions/`  | `CODING_INSTRUCTIONS`: coding guidance inserted before host extras                                |
| `read-file/`     | `read_file`, and the `FileRead` artifact with its `isFileRead` guard                              |
| `grep/`          | `grep`: ripgrep search of the workspace, and the `GrepResult` artifact with its guard             |
| `glob/`          | `glob`: files matching a pattern, newest first, and the `GlobResult` artifact with its guard      |
| `read-skill/`    | `read_skill`: a skill's SKILL.md or a file in its folder, from the project's or the user's        |
| `write-file/`    | `write_file`                                                                                      |
| `edit-file/`     | `edit_file`                                                                                       |
| `delete-file/`   | `delete_file`: removes one file, through the workspace and the file lock                          |
| `run-command/`   | `run_command`: base-command permissions, safe git config, approvals                               |
| `trail/`         | `fileTrail`: one short line per file-tool or `run_command` call, for a summary's trail            |
| `working-root/`  | `set_working_root` and the hook that tells the agent its root each turn                           |
| `files/`         | What the file tools share: `resolveWritable` / `resolveDeletable`, the `.env` guard, `FileChange` |
| `trust/`         | `TrustStore`: which workspaces the user trusts to run their `.sheavly/` hooks, outside every repo |
| `project-hooks/` | `loadProjectHooks`: the `.sheavly/` hooks, only in a trusted workspace                            |
| `agents-md/`     | `agentsMdSource`: AGENTS.md files as append-only instruction context                              |
| `skills/`        | `findSkills`, `skillsSource`, `skillRequest`; mentions and completion for UIs                     |
| `errors/`        | `CommandRefusedError`, and the trust, project-hook, AGENTS.md and skill errors                    |
| `testing/`       | Fakes for tests: `memoryTrust`, `useSkillFolders`, `fakeBeforeTurn`                               |

## Built-in hook names

The instruction hooks are named `agents-md`, `skills`, `scratch` and `working-root`, in that
order among the ones present (`scratch` is only registered when the workspace has a scratch
root). The names are a stable contract: a third-party extension positions its hooks against them
with `placeHook({ hook, before: [CODING_HOOK_NAMES.agentsMd] })`, so renaming one is a breaking
change. Import `CODING_HOOK_NAMES` from `@sheavly/coding/extension/coding-hook-names.constants`.
The `.sheavly/` project hooks come after them, under their own names. The `scratch` literal lives
in `@sheavly/workspace`, which cannot import an extension;
`src/extension/__tests__/coding-hook-names.test.ts` pins all four against the hooks the extension
builds. `sheavly.json` lists the same four names next to a bare `*` for the project hooks, so the
host would not notice a fifth name added to the constant but not to the file; the test in
`src/extension/__tests__/coding-extension.helper.test.ts` compares the two.

## Docs

`run_command` starts required finite work with `background: true`: the loop keeps the prompt alive
until its result is delivered. Persistent servers and watchers use the `start_service` tool
instead, which has the same checks and approval. The agent can finish independent work, then yield without polling task status.
The generic `await_tasks({ ids, reason })` tool can group results for delivery together; its reason
preserves the dependent decision or next step for the agent after a summary.

With an output store (the conversation's `OutputStore`, supplied to the run as `OUTPUT_CAPTURE` for
writing and `OUTPUT_READER` for `read_output`), `run_command` keeps every command's complete
captured stdout and stderr, foreground or background, independent of the bounded preview. Output
printed before a failure, timeout or cancellation stays readable, and a running service's log can be
read as it grows. The result carries `output_ref=<id>`, the bytes stored and whether the log is
`complete`, `capturing` or `INCOMPLETE`. When the preview is shorter than the log, the result also
tells the model to use `read_output` or `search_output` instead of rerunning the command. Pipeline
stdin gets the original bytes; stdout routed into a pipe is not duplicated in the log, only what the
last stage and every stderr print. If storage cannot start a capture the command still runs and the
result says the full output is not being stored; a storage failure mid-capture marks the log
incomplete, never complete. Without it only the preview exists, as before.

The preset returns `instructions`: generic core, coding guidance, then caller extras. Its inherited
`baseInstructions` option replaces only the generic core, not coding guidance. Conversations use
this text by default; direct loop callers pass it explicitly. See
[instruction composition](../../packages/host/docs/harness.md#instruction-composition).
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
- [Skills](docs/skills.md): the skill format, where skills are found, and which one wins;
  `read_skill` returns complete skill files without line or character caps, while preserving path
  confinement and `.env` protection. Ordinary `read_file` limits are unchanged.
- [AGENTS.md](docs/agents-md.md): which files the hook reads, and when.
- [Project hooks](docs/project-hooks.md): writing `.sheavly/` hooks, loading them, and workspace
  trust.
- [run_command](docs/run-command.md): how a command is checked before it runs.
