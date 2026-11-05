# What a run includes

The packages provide pieces and the services a run shares; the backend decides what its runs
include, in one place, `createBackendHarness` (`src/harness/harness.helper.ts`). Every
conversation it serves, for whichever UI, is built on it, by `servedConversation`
(`src/harness/served.helper.ts`), so they all run the same agent.

## The run

`createBackendHarness` opens the coding services (`createCodingHarness`: the workspace, file
locks and process runner), then composes:

| What                                   | From                 | Why                                                                                                               |
| -------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `read_file`, `write_file`, `edit_file` | `@sheavly/coding`    | A coding agent works on files; all three share the run's `FileLocks` and `FileReads` (an edit needs a read first) |
| `read_skill`                           | `@sheavly/coding`    | Reads a listed skill, from the project's or the user's skill folders                                              |
| `run_command`                          | `@sheavly/coding`    | Commands, piped and chained without a shell; the user is asked before any they have not allowed                   |
| `task_status`, `cancel_task`           | `@sheavly/tools`     | Background commands and sub-agents                                                                                |
| `start_agent`, `message_agent`         | `@sheavly/tools`     | Sub-agents get the file tools, `read_skill`, AGENTS.md and skills, not `run_command`                              |
| The AGENTS.md hook                     | `@sheavly/workspace` | First, so the project's rules apply from the first call                                                           |
| The skills hook                        | `@sheavly/workspace` | Lists the [skills](../../../packages/workspace/docs/skills.md), the user's too (`~`)                              |
| The `.sheavly/` hooks                  | `@sheavly/workspace` | Only in a trusted workspace (`--trust`); `projectTrust` says why not                                              |

Sub-agents get neither `run_command` nor the `.sheavly/` hooks: a sub-agent starts on a narrow
task, and commands are where the trust model has the most to lose.

`servedConversation` wraps it as a conversation (`harnessConversation`: the workspace's skills,
`MAX_TURNS`, `WAIT_FOR_TASKS`) and reports its run for `GET /conversations/:id`: the workspace,
the model in use and the ones it can switch to, workspace trust and the permission mode (read when
asked, since the user can change it while the conversation runs). A run's `run_command` reads its
folder's permissions from the user's folder (`workspacePermissions`), so a mode or an allowed
command applies to every conversation in that folder from its next command.

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
  without touching the ones running.
- **A model that can't be used** (no key, a definition its adapter refuses) is left out with a
  note on the log, and never costs the user the others. A note says which model and why, never the
  key and never what a provider answered.
- **Not set up.** With no profile for the workspace, or none with a usable model, a conversation is
  refused with `not_set_up` (HTTP 409) and a message that says what to do, and a UI onboards the
  user. The backend starts all the same: it has to be running for a UI to set it up.
- **Trust** is `trusted-workspaces.json` in the same folder (`trustStoreFor`), shared by every
  profile, and outside every repo so a repo can't trust itself.

## Settings

What stays in the environment is how this process runs, not who the user is. `serve.ts` passes
`process.env` in:

- `SHEAVLY_HOME`: the user's folder (default `.sheavly` in their home).
- `parseRequestEnv`: how each model call is sent, `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES` and
  `MODEL_RETRY_DELAY_MS`, defaulting to `REQUEST` (60s, 2 retries, 1s). See
  [sending a call](../../../packages/providers/docs/backends.md#sending-a-call-timeouts-and-retries).
- `parseServerEnv` and `parseRunEnv`: where it listens, and how each conversation runs
  ([serve.md](serve.md#settings)).
- `harness.constants.ts`: the request policy, and `MAX_TURNS` (model calls per session, 20: room for
  multi-step sub-agent work).

No package has any of these: another backend reads its own settings and composes its own run.
