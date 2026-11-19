# Design

How the agents extension works, and why sub-agents get their tools this way.

## It gets what any extension gets

The session metadata, the sub-agents it owns, its background tasks, the task control, the model,
the composed instructions and the optional output reader reach `activate` as scoped run services:
`services.get(SESSION_INFO)`, `CHILD_SESSIONS`, `BACKGROUND_TASKS`, `TASK_CONTROL`, `MODEL`,
`INSTRUCTIONS` and `services.find(OUTPUT_READER)`, all keys of
`@sheavly/host/run-services/run-services.utils`. The app supplies them with `runServices`; nothing
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

`SUB_AGENTS` is write-only: the service is a frozen object with `share` alone, which copies the
arrays it is given (the tool and hook objects are held by reference, not frozen) and validates
them first: each entry must be an object with a non-empty string `name`, and a name repeated in
the call, already shared, or one of the tools every sub-agent gets from this extension
(`report_status`, `start_agent`, the task tools…) throws a `SubAgentShareError` and shares nothing
from that call. The three lists live in a closure only this extension's sub-agent tool reads, because
the shared tools close over services that hold grants and the hooks are every extension's: a
reader of the service can neither call them nor change them. A grant cannot be defined by an
extension-provided service in this version, so reading it is gated by `requires` alone: `share`
cannot check the sharer's own `tools` and `hooks` declarations. That is a known gap since the
service was introduced; the intended fix is a grant, once extension-provided services can define
grants. The
sub-agent tool reads the lists when it starts a sub-agent, not when it is built, so an extension
that activates after `agents` (it must depend on it) still reaches every child.

- `tools`: given to the main run as well, and to sub-agents (file tools, web tools).
- `taskTools`: tools that start background work (`run_command`). They are built once on the run's
  one task registry; what a call starts is owned by the session that made it. Having any means a
  sub-agent can inspect and cancel what it starts, even at the nesting limit.
- `hooks`: run by sub-agents too, each running its own `sessionStart`.

## Adding to it

Extend, don't edit: a new kind of tool for sub-agents is an extension that depends on `agents` and
shares it. Changing `agents.helper.ts` for one caller is the mistake.
See [the extensions guide](../../../.agents/skills/sheavly/extensions.md).
