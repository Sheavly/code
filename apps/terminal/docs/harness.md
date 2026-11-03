# What a terminal run includes

The packages provide pieces and the services a run shares; the terminal app decides what its runs
include, in one place, `createTerminalHarness` (`src/harness/harness.helper.ts`). The demo and the
workbook both use it, so they run the same agent.

## The run

`createTerminalHarness` opens the coding services (`createCodingHarness`: the workspace, file
locks and process runner), then composes:

| What                                   | From                 | Why                                                                            |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `read_file`, `write_file`, `edit_file` | `@sheavly/coding`    | A coding agent works on files; all three share the run's `FileLocks`           |
| `run_command`                          | `@sheavly/coding`    | Tests and builds; `skipAllowList` only with `RUN_COMMAND_SKIP_ALLOW_LIST=true` |
| `task_status`, `cancel_task`           | `@sheavly/tools`     | Background commands and sub-agents                                             |
| `start_agent`, `message_agent`         | `@sheavly/tools`     | Sub-agents get the file tools and the AGENTS.md hook, not `run_command`        |
| The AGENTS.md hook                     | `@sheavly/workspace` | First, so the project's rules apply from the first call                        |
| The `.sheavly/` hooks                  | `@sheavly/workspace` | Only in a trusted workspace (`--trust`); `projectTrust` says why not           |

Sub-agents get neither `run_command` nor the `.sheavly/` hooks: a sub-agent starts on a narrow
task, and commands are where the trust model has the most to lose.

## Settings

`src/harness/settings.helper.ts` reads them from the environment the entry point passes in
(`process.env`, after loading `.env`):

- `providerFromEnv`: `ADAPTER` picks `openai` (the default) or `azure`, each with its own keys
  (`settings.validator.ts`), and builds the provider from `@sheavly/providers`' registry. A missing
  key fails with the name of what to set.
- `trustStoreFromEnv`: `SHEAVLY_TRUST_FILE`, else `$XDG_CONFIG_HOME/sheavly/trusted-workspaces.json`
  (default `~/.config/sheavly/`).
- `parseRequestEnv`: how each model call is sent, `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES` and
  `MODEL_RETRY_DELAY_MS`, defaulting to `REQUEST` (60s, 2 retries, 1s).
- `harness.constants.ts`: the default backend and model, the request policy, and `MAX_TURNS` (model calls per session,
  20: room for multi-step sub-agent work).

No package has any of these: another UI reads its own settings and composes its own run.
