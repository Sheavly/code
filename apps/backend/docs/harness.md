# What a run includes

The coding harness supplies shared generic instructions, coding guidance and any explicit host
extras. Backend conversations use that composed text by default; sub-agents receive it before
their narrower child role. The terminal and workbook use this same backend path, not separate
prompt copies. See [instruction composition](../../../packages/host/docs/harness.md#instruction-composition).

The packages provide pieces and the services a run shares; the backend decides what its runs
include, in one place, `createBackendHarness` (`src/harness/harness.helper.ts`). Every
conversation it serves, for whichever UI, is built on it, by `servedConversation`
(`src/harness/served.helper.ts`), so they all run the same agent.

## The run

`createBackendHarness` opens the coding services (`createCodingHarness`: the workspace, file
locks and process runner), then composes:

| What                                                  | From                 | Why                                                                                                                                      |
| ----------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `read_file`, `write_file`, `edit_file`, `delete_file` | `@sheavly/coding`    | A coding agent works on files; all four share the run's `FileLocks` and `FileReads` (an edit needs a read first)                         |
| `glob`, `grep`                                        | `@sheavly/coding`    | Discover workspace files and search their contents with dedicated, confined tools rather than shell discovery                            |
| `read_skill`                                          | `@sheavly/coding`    | Reads a listed skill, from the project's or the user's skill folders                                                                     |
| `web_fetch`                                           | `@sheavly/tools`     | Public HTTP(S) pages as readable text, with bounded downloads and no credentials; omitted with `WEB_FETCH=false`                         |
| `web_search`                                          | `@sheavly/tools`     | Bounded titles, URLs and snippets, with UI artifacts; keyless Tavily unless another backend is injected, omitted with `WEB_SEARCH=false` |
| `run_command`                                         | `@sheavly/coding`    | Commands, piped and chained without a shell; the user is asked before any they have not allowed                                          |
| `task_status`, `cancel_task`, `await_tasks`           | `@sheavly/tools`     | Inspect or cancel background work, or group its completions with a reason                                                                |
| `start_agent`, `message_agent`                        | `@sheavly/tools`     | Sub-agents get file tools, `read_skill`, the run's task registry (scoped to their session) and `run_command`, plus the shared hooks      |
| The AGENTS.md hook                                    | `@sheavly/workspace` | First, so the project's rules apply from the first call                                                                                  |
| The skills hook                                       | `@sheavly/workspace` | Lists the [skills](../../../packages/workspace/docs/skills.md), the user's too (`~`)                                                     |
| The `.sheavly/` hooks                                 | `@sheavly/workspace` | Only in a trusted workspace (`--trust`); `projectTrust` says why not                                                                     |

Sub-agents receive the same file tools, including `glob`, `grep` and `delete_file`, and enabled web
tools as the main agent. Their `task_status`, `cancel_task` and `await_tasks` operate on their own
task registry, including at the nesting limit; only further delegation is disabled there.
Sub-agents run commands on their own task registries with the same workspace permissions and
approvals as the parent. They receive the same hooks, including `.sheavly/` hooks only when the
workspace is trusted. A child's finite work keeps that child active before it reports to its parent.
The backend explicitly passes `web_fetch` to sub-agents when enabled. The same tool instance
shares the host's limits and domain policy, but each call has its own request and cancellation.
See [web fetch](../../../packages/tools/docs/web-fetch.md) for address rules and defaults.

The backend also explicitly selects keyless Tavily for `web_search`, with no signup or credential
setup. Search queries are sent to Tavily only when the tool is called; results are untrusted
external data. Free access is rate-limited, and a failure reports the backend and reason without
silently switching services. `WEB_SEARCH=false` omits search from both main and sub-agent runs.
An embedding app can instead pass `webSearch: { backend }` to `createBackendHarness`, using its
own search backend or a Tavily backend constructed with an injected API key. Credentials are
not model input, and packages never discover them from the environment. See
[web search](../../../packages/tools/docs/web-search.md) for the contract, bounds and artifacts.

**Summaries.** Unless `SUMMARY=false`, the main run and every sub-agent summarize their history
when the context nears the window (`backendSummary`, `harness/summary.helper.ts`). The model the
conversation is on writes the sections it is asked for (`modelSummarizer`, `@sheavly/summary`),
and rules keep the user's own words and a trail of the files and commands the work touched
(`fileTrail`, `@sheavly/coding`). The main run's summarizer uses the model switch, so a switch
changes who writes the next summary; a sub-agent's uses its pinned model. A sub-agent's first
message is the task its parent agent wrote, so its checkpoint lists it under "Task from the parent
agent", never "What the user asked for" (`subAgentSummary`). A trail line is left out when its
call's result was an error. The parent-task heading is authored in the internal
`harness/summary.prompt.ts`; provider selection, redaction and section wiring stay in
`summary.helper.ts`.

Summaries are on by default, so a long history, tool inputs and results included, is sent to the
model that writes the summary: the same provider the conversation already uses, in an extra call.
Credential forms are redacted first, and again in what the model writes (`redactDiagnosticText`,
a pattern match that misses unfamiliar forms). `SUMMARY=false` sends nothing extra. Thresholds are
the loop's defaults; the
[loop doc](../../../packages/loop/docs/run.md#summaries) says how a checkpoint is made and
rejected.

AGENTS.md and skill-list updates are appended as instruction context, not substituted into the
system prompt. Earlier messages remain unchanged, keeping Claude's signed reasoning valid.

`servedConversation` wraps it as a conversation (`harnessConversation`: the workspace's skills,
`MAX_TURNS`) and reports its run for `GET /conversations/:id`: the workspace,
the model in use and the ones it can switch to, workspace trust and the permission mode (read when
asked, since the user can change it while the conversation runs). A run's `run_command` reads its
folder's permissions from the user's folder (`workspacePermissions`), so a mode or an allowed
command applies to every conversation in that folder from its next command.

Finite background commands and sub-agent replies keep the prompt alive by default and resume
the parent automatically when they finish. Persistent services (`backgroundKind: 'service'`)
are exempt: they may outlive a prompt without keeping it active. Interrupting a prompt cancels
its background work, including sub-agent descendants, and does not restart it automatically.

`workspacePermissions` creates one `ConversationPermissions` per live conversation. Permanent
entries still come from the workspace store; temporary `allow_session` entries live only in that
object and are not restored on reopen. Main and sub-agent command tools sharing it reuse the
grants; sub-agent commands do not bypass permission checks.

## Models and keys

The models a conversation runs on are the user's, kept in their folder (`~/.sheavly`, or
`SHEAVLY_HOME`), never in the environment and never in a `.env`:

- **A profile** is a bundle of models, keys and conversations (work, personal). A workspace runs
  on the profile it is bound to, else the default one (`ProfileRegistry.profileFor`). Nothing
  is named by what a person typed: a profile and a model are their ids (lowercase UUIDs); the
  name is a label.
- **`Profiles`** (`src/profiles/profiles.service.ts`) is the one place in the backend that holds a
  key. `modelsFor` combines each of the profile's models with its key, builds a provider for it
  through the adapter registry (`@sheavly/providers`), and puts them behind one `ProviderSwitch`
  keyed by model id. Each conversation gets its own switch, so changing one conversation's model
  leaves the others alone; `PUT /conversations/:id/model` (the chat's `/model`) switches it.
- **Where it starts.** A new conversation starts on the profile's last model (the one chosen last
  in any of its conversations), else its first. A switch is remembered for the next conversation
  without touching the ones running. Profiles keep `lastModelSelection` (the model/mode pair)
  and `modelModes` (each model's last-used effort). Low, medium, high and extreme are reasoning
  modes; a model with no remembered mode starts on medium. Switching back to a model restores
  its latest mode in the profile, even if another conversation changed that preference. A
  resumed conversation instead restores its own saved pair. A mode-only switch is persisted
  through the same API, without changing the model.
- **DeepSeek snapshot setup.** The app catalogue offers **DeepSeek V4.1 Flash (1017)** with
  identity `DeepSeek-V4.1-Flash-1017`, family `deepseek`, and only the `azure-chat` hosting route.
  Its suggested deployment is that exact snapshot string; a differently named Azure deployment
  can retain the same model identity. The preset sets `replayReasoning: true`,
  `thinkingMode: enabled` and `effortProfile: deepseek`. The existing **DeepSeek V4 Flash** entry
  still suggests `deepseek-v4-flash` with only `replayReasoning: true`; neither catalogue listing
  nor provider construction rewrites saved definitions or silently switches their effort profile.
  The explicit DeepSeek profile maps medium to `high` and extreme to `max`; low and high retain
  their names. Omitting the profile keeps the adapter's OpenAI mapping (extreme to `xhigh`).
  Use the Azure Foundry Chat Completions endpoint, for example
  `https://resource.test/models/chat/completions?api-version=2024-05-01-preview`, not Responses.
  The user confirmed that endpoint shape and API version for the requested deployment. Offline
  fake-transport tests verify setup persistence, provider construction, request fields and
  same-endpoint/model plain-reasoning replay. They do **not** verify live Azure acceptance,
  reasoning behavior, cached-token reporting, cache billing or model quality; no live call was
  made to establish those properties. Resource hostnames and private connection settings are
  not catalogue defaults.
- **Responses caching.** `openai` and `azure-openai` models use explicit caching unless their
  definition sets `explicitCache: false`; the backend stores, shows and checks the definition as
  given and never guesses from a model or deployment name. A deployment before GPT-5.6 rejects the
  fields with a 400, so it must set `explicitCache: false`. See
  [prompt caching](../../../packages/providers/docs/prompt-caching.md).
- **A model that can't be used** (no key, a definition its adapter refuses) is left out with a
  note on the log, and never costs the user the others. A note says which model and why, never the
  key and never what a provider answered.
- **Not set up.** With no profile for the workspace, or none with a usable model, a conversation is
  refused with `not_set_up` (HTTP 409) and a message that says what to do, and a UI onboards the
  user. The backend starts all the same: it has to be running for a UI to set it up.
- **Trust** is `trusted-workspaces.json` in the same folder (`trustStoreFor`), shared by every
  profile, and outside every repo so a repo can't trust itself.
- **Permissions** are `permissions/<workspace-key>.json` in the same folder (`permissionStoreFor`),
  shared by every profile for the same reason: what `run_command` may run is about a folder, and
  must be somewhere the agent can't edit. `PermissionSetup` is what the permission routes call;
  `workspacePermissions` is what a run's `run_command` reads.

## Settings

What stays in the environment is how this process runs, not who the user is. `serve.ts` passes
`process.env` in:

- `SHEAVLY_HOME`: the user's folder (default `.sheavly` in their home).
- `parseRequestEnv`: how each model call is sent, `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES` and
  `MODEL_RETRY_DELAY_MS`, defaulting to `REQUEST` (60s, 2 retries, 1s). See
  [sending a call](../../../packages/providers/docs/backends.md#sending-a-call-timeouts-and-retries).
- `parseServerEnv` and `parseRunEnv`: where it listens, and how each conversation runs
  ([serve.md](serve.md#settings)).
- `harness.constants.ts`: the request policy. A run has no turn limit unless `MAX_TURNS` sets one.

No package has any of these: another backend reads its own settings and composes its own run.
