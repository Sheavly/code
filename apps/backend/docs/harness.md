# What a run includes

The packages provide pieces and the services a run shares; the backend decides what its runs
include, in one place, `createTerminalHarness` (`src/harness/harness.helper.ts`). Every
conversation it serves (the terminal's chat, demo and workbook, and any other UI's) is built on
it, by `servedConversation` (`src/harness/served.helper.ts`), so they all run the same agent.

## The run

`createTerminalHarness` opens the coding services (`createCodingHarness`: the workspace, file
locks and process runner), then composes:

| What                                   | From                 | Why                                                                                  |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `read_file`, `write_file`, `edit_file` | `@sheavly/coding`    | A coding agent works on files; all three share the run's `FileLocks`                 |
| `read_skill`                           | `@sheavly/coding`    | Reads a listed skill, from the project's or the user's skill folders                 |
| `run_command`                          | `@sheavly/coding`    | Tests and builds; `skipAllowList` only with `RUN_COMMAND_SKIP_ALLOW_LIST=true`       |
| `task_status`, `cancel_task`           | `@sheavly/tools`     | Background commands and sub-agents                                                   |
| `start_agent`, `message_agent`         | `@sheavly/tools`     | Sub-agents get the file tools, `read_skill`, AGENTS.md and skills, not `run_command` |
| The AGENTS.md hook                     | `@sheavly/workspace` | First, so the project's rules apply from the first call                              |
| The skills hook                        | `@sheavly/workspace` | Lists the [skills](../../../packages/workspace/docs/skills.md), the user's too (`~`) |
| The `.sheavly/` hooks                  | `@sheavly/workspace` | Only in a trusted workspace (`--trust`); `projectTrust` says why not                 |

Sub-agents get neither `run_command` nor the `.sheavly/` hooks: a sub-agent starts on a narrow
task, and commands are where the trust model has the most to lose.

`servedConversation` wraps it as a conversation (`terminalConversation`: the workspace's skills,
`MAX_TURNS`, `WAIT_FOR_TASKS`) and reports its run for `GET /conversations/:id`: the workspace,
the model in use and the ones it can switch to, workspace trust and the allow list.

## Settings

`src/harness/settings.helper.ts` reads them from the environment `serve.ts` passes in
(`process.env`, after loading `.env`):

- `providerFromEnv`: `MODELS` lists several models by name, each with its own keys
  (`models.validator.ts`, see [several models](#several-models-on-azure)), behind one
  `ProviderSwitch` that starts on the first; `PUT /conversations/:id/model` (the chat's `/model`)
  switches it. Without `MODELS`, `ADAPTER` picks `openai` (the default) or `azure`, each with its
  own keys (`settings.validator.ts`). Either way the providers come from `@sheavly/providers`'
  registry, and a missing key fails with the name of what to set.
- `trustStoreFromEnv`: `SHEAVLY_TRUST_FILE`, else `$XDG_CONFIG_HOME/sheavly/trusted-workspaces.json`
  (default `~/.config/sheavly/`).
- `parseRequestEnv`: how each model call is sent, `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES` and
  `MODEL_RETRY_DELAY_MS`, defaulting to `REQUEST` (60s, 2 retries, 1s). See
  [sending a call](../../../packages/providers/docs/backends.md#sending-a-call-timeouts-and-retries).
- `parseServerEnv` and `parseRunEnv`: where it listens, and how each conversation runs
  ([serve.md](serve.md#settings)).
- `harness.constants.ts`: the default backend and model, Claude's default `max_tokens`, the
  request policy, and `MAX_TURNS` (model calls per session, 20: room for multi-step sub-agent
  work).

No package has any of these: another backend reads its own settings and composes its own run.

## Several models on Azure

`MODELS` names the models to set up, comma-separated; a conversation starts on the first, and
`/model <name>` switches between them (from the next model call; the conversation keeps its
history). Each name's keys are named after it, upper-cased with `-` as `_` (`deepseek-flash` reads
`DEEPSEEK_FLASH_*`), so each model has its own key, endpoint and deployment:

- `<NAME>_ADAPTER`: `azure` (the Responses API: GPT, DeepSeek and other Foundry models) or
  `azure-anthropic` (Claude).
- `<NAME>_API_KEY`, `<NAME>_BASE_URL`, `<NAME>_DEPLOYMENT`: required.
- `azure` only: `<NAME>_API_VERSION` (for a dated URL) and `<NAME>_REASONING` (`false` for a model
  that sends no encrypted reasoning back; default `true`).
- `azure-anthropic` only: `<NAME>_MAX_TOKENS` (default 16000) and `<NAME>_THINKING_BUDGET`
  (extended thinking, at least 1024; unset = off).

With `MODELS` set, `ADAPTER` and its keys are not read. The example `.env` has one of each.
