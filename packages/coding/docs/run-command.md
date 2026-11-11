# run_command

Commands run without a shell through the workspace's `ProcessRunner`. The approval registry
([@sheavly/runtime](../../runtime/docs/approvals.md)) asks only about base commands, never options
or file operands.

The adjacent `run-command.prompt.ts` holds the tool description, input guidance and background-launch
instructions. Its pure builders receive whether background work is enabled and the prepared launch
facts; parsing, approval, safe Git configuration and process/task execution remain in runtime code.

## What a command is

`parseCommand` splits a line into parsed argument arrays and `|`, `&&`, `||` or `;` connectors.
Single quotes preserve literal text; double quotes group words with POSIX escaping rules.
Redirects, shell variables/substitution, backticks, parentheses, newlines, backslashes outside
quotes and a lone `&` are unsupported. Parsing restrictions remain in every permission mode.
There is no glob expansion: `wc *.ts` receives a literal `*.ts`. A program may interpret its
own patterns, but the runner never expands them or filters `.env` files from grep arguments.

## Who decides

The app supplies `CommandPermissions`, read fresh on every invocation. This package does not
store preferences or read a terminal. Workspace permissions are shared across conversations;
session grants belong to the live conversation and are not persisted.

| Mode         | Behavior                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `ask`        | Built-in or user-approved base commands run with every option and argument. Other commands ask. |
| `always_ask` | Every command asks, ignoring built-in and user grants. No remembered grant is offered.          |
| `allow_all`  | Approval is skipped; unsupported command syntax is still rejected.                              |

Automatic approvals are limited to bare `ls`, `pwd` and `stat`, which report metadata rather
than file contents. Content readers (`cat`, `head`, `tail`, `wc`) and all Git commands require
an explicit approval or user grant. Git options can expose arbitrary files or launch programs;
`wc --files0-from` can expose file contents through diagnostics. A path-qualified executable
such as `./ls` does not inherit a built-in approval merely by sharing its name.

An explicit user grant still has all-arguments semantics: granting `cat *` permits secret and
outside paths, granting Git diff permits patches, and granting Git add permits broad staging.

### Base-command identity

`commandBase` ignores all options and operands after identifying the command:

- Ordinary executables keep their name: `find *`, `sed *`, `node *`, `grep *`.
- Git keeps its subcommand: `git diff *` does not approve `git push *`.
- npm keeps its operation, and run/run-script also keeps the script: `npm run test *`.
  npm's test aliases normalize to the same script. Routing and execution options are ignored.
- npx keeps the invoked command/package name: `npx eslint *` covers checking, fixing, arbitrary
  options, package overrides and downloads. Version/tag suffixes do not create another scope;
  scoped package names remain distinct. A broad `npx *` deliberately covers every npx command.
- GitHub CLI command groups keep their action: `gh issue view *` is distinct from
  `gh issue edit *`; endpoints of `gh api` are operands, not command identities.
- Executable locations do not create path scopes: `/usr/bin/find` has base command `find`.

Only leading wrapper options need parsing to find a subcommand or npm script. This parsing
does not authorize or reject option values. Arguments do not affect an approved command:
secret paths, outside-workspace paths, editing/execution flags, custom configuration and
unverified packages never trigger an additional question.

Each command in a chain is checked independently before the line runs. Approving
`npm run test` does not approve `npm run test && npm install another`; the install command
needs its own grant. One question covers all unapproved commands, and skipping it runs none.

### Approval decisions

- **Run once** runs the current line without remembering anything.
- **Allow for this session** remembers the proposed base grants in the conversation when the
  caller supports `allowSession`.
- **Always allow** saves the proposed base grants for the workspace.
- **Skip** refuses the line and tells the model not to retry.
- **Skip with a message** includes the user's alternative direction in the refusal.

`ApprovalRequest.keeps` lists the grants being offered. Entries are saved before execution;
if saving fails, the command does not run. With no listening UI, an unapproved command fails
immediately rather than running unattended.

### Existing permission files

Legacy exact/path-specific entries and `read:`, `tool:` or `script:` entries are interpreted
as base-command grants too. `sed -n 1,200p src/a.ts` and `read:sed *` both approve `sed *`;
`tool:npx eslint check *` approves `npx eslint *`; `script:node tmp/probe.mjs *` approves `node *`.
`exact:` JSON arrays preserve old stored data and command names containing spaces, but no
longer require exact argument matching. The file is not rewritten automatically. The UI
describes the effective command scope rather than claiming old restrictions remain.

## Execution protections and limits

### Background lifecycle

`background: true` returns a task id immediately. Its default `backgroundKind: 'task'` means finite
work, such as a build, test run or CI wait. The tool forwards `backgroundKind` to the task registry,
so the loop keeps the calling prompt alive until it delivers the result.
The agent finishes independent work and ends its turn without tool calls to wait. Completion is
delivered automatically; `task_status` is for requested inspection or diagnosis, not polling.

Use `backgroundKind: 'service'` for a persistent server or watcher. It remains non-blocking by
default and can outlive the prompt. Use `cancel_task` to stop a service when finished.

When several results inform one decision, `await_tasks({ ids, reason })` registers a completion
group immediately: the registry holds their notices until all members finish, then delivers them
together with the reason. Explain the dependent decision or next step for your future self after
a summary, not just "waiting for results". Grouping does not block the tool call or make
`task_status` a wait tool.

Existing `background: true` calls now start required finite work. Callers launching persistent
processes must explicitly select `backgroundKind: 'service'`. The kind has no effect on foreground
commands. Interrupting a run stops its wait and cancels its background work; closing a conversation
also shuts its tasks down. The call's abort signal is checked after asynchronous permission and
approval work, before launch, so a delayed permission read cannot start a fresh task or service
after interruption cleanup.

### Process protections

Every process still receives safe Git configuration that disables repository hooks,
filesystem monitors and signature programs, and uses committed attributes. Git diff/log/show
retain `--no-ext-diff --no-textconv` driver protection. These do not add approval questions.

There is no OS sandbox. Command approval grants the process access available to the user,
including secrets and files outside the workspace. `read_file`, `write_file`, `edit_file` and
`delete_file` retain their separate confinement and secret-file rules; command permissions do not
change those tools. See the [trust model](../../../docs/overview.md#trust-model).
