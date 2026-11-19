# Design

How the agents extension works, and why sub-agents get their tools this way.

## It gets what any extension gets

The session metadata, the sub-agents it owns, its background tasks, the task control, the model,
the composed instructions and the optional output reader reach `activate` as scoped run services:
`services.get(SESSION_INFO)`, `CHILD_SESSIONS`, `BACKGROUND_TASKS`, `TASK_CONTROL`, `MODEL`,
`INSTRUCTIONS` and `services.find(OUTPUT_READER)`, all keys of
`@sheavly/extension/run-services/run-services.utils`. The app supplies them with `runServices`; nothing
is injected into this extension that a third-party extension could not read the same way, and
what each can do for it is what its `sheavly.json` `grants` list: `session:read`,
`sub-agent:create|message|observe|report`, `task:start|read|cancel` (the tasks it started),
`task:read-any|cancel-any` (any task of the calling session, which is what the task tools do),
`model:call` and `output:read`. The extension never holds a registry or the loop:
`child-sessions` builds the session and passes the run's full registries to the loop itself, keeps
the sub-agent's history and stops the sub-agent's own tasks when it ends. Another extension's
sub-agents and tasks read as unknown to it. See
[scoped run services](../../../packages/host/docs/run-services.md).

`INSTRUCTIONS` is a read-only view whose `text` composes the system prompt at each read. The
extension holds the view, not the text: extensions that activate after it (`coding`) contribute
sections, so the text it would read in `activate` is not the final one. `start_agent` reads it
when each sub-agent starts, so a sub-agent gets the base, every extension's sections and the
app's extras, then its own role rules.

## The sub-agent tool starts with nothing

`start_agent` is built here, but with no tools or hooks of its own. A sub-agent's tools are what
the extensions of the run share with it: `services.get(SUB_AGENTS).share({ tools, taskTools,
hooks })`. So this extension never learns what coding, web or any other extension adds.

`SUB_AGENTS` is provided per consumer (`services.provideFor`) behind the grant `sub-agent:share`,
which `sheavly.json` declares under `services.grants` so the host's catalogue and an installer see
it before any code runs. An extension that shares lists `sub-agents` in `services.requires` and
`sub-agent:share` in its `grants`; `share` on its scope throws an `ExtensionUndeclaredError` (`use:
'grant'`, naming the extension and the grant) otherwise, before anything is validated or kept. Once
the consumer or this extension stops, the host disarms the scope and `share` throws the host's
`ScopeDeactivatedError`. This extension's own output tools are shared on the raw scope in its
closure, with no grant: it is not a consumer of its own service. The host cannot check that
`share` makes the check; the tests of this extension do.

Each consumer's scope is a frozen object with `share` alone, which copies the
arrays it is given (the tool and hook objects are held by reference, not frozen) and validates
them first: each entry must be an object with a non-empty string `name`, and a name repeated in
the call, already shared, or one of the tools every sub-agent gets from this extension
(`report_status`, `start_agent`, the task tools…) throws a `SubAgentShareError` and shares nothing
from that call. The three lists live in a closure only this extension's sub-agent tool reads, because
the shared tools close over services that hold grants and the hooks are every extension's: a
reader of the service can neither call them nor change them. The lists are common to all
consumers, so a name one shared blocks the same name from another while it is shared. The
sub-agent tool reads the lists when it starts a sub-agent, not when it is built, so an extension
that activates after `agents` (it must depend on it) still reaches every child.

**Revoked.** Each entry a consumer shares is recorded with its owner, the consumer's name from
the host's frozen snapshot (the raw scope's `share` takes an optional owner; this extension's own
output tools have none and are never revoked). When the consumer's scope is disarmed, which the
host does on every path that ends the consumer (its `activate` threw after sharing, a roll-back, a
stop) and when `agents` itself stops, everything that owner shared is taken out of the lists in
place and its names are free again. Revoked means: a sub-agent started afterwards does not get
it. `start_agent` copies the lists when it starts a sub-agent, so a sub-agent already running
keeps the tools and hooks it was given until it ends. A hook runs with the loop's authority, which
is why an extension that failed or stopped must not keep one reaching new sub-agents.

- `tools`: given to the main run as well, and to sub-agents (file tools, web tools).
- `taskTools`: tools that start background work (`run_command`). They are built once on the run's
  one task registry; what a call starts is owned by the session that made it. Having any means a
  sub-agent can inspect and cancel what it starts, even at the nesting limit.
- `hooks`: run by sub-agents too, each running its own `sessionStart`.

## Adding to it

Extend, don't edit: a new kind of tool for sub-agents is an extension that depends on `agents` and
shares it. Changing `agents.helper.ts` for one caller is the mistake.
See [the extensions guide](../../../.agents/skills/sheavly/extensions.md).
