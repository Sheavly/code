# Design

How the agents extension works, and why sub-agents get their tools this way.

## It gets what any extension gets

The sessions, the task registry, the provider, the composed instructions and the optional output
store reach `activate` as run services: `services.get(SESSIONS)`, `TASKS`, `PROVIDER`,
`INSTRUCTIONS` and `services.find(OUTPUTS)`, all keys of
`@sheavly/host/run-services/run-services.utils`. The app supplies them with `runServices`; nothing
is injected into this extension that a third-party extension could not read the same way.

## The sub-agent tool starts with nothing

`start_agent` is built here, but with no tools or hooks of its own. A sub-agent's tools are what
the extensions of the run share with it: `services.get(SUB_AGENTS).share({ tools, taskTools,
hooks })`. So this extension never learns what coding, web or any other extension adds.

`SUB_AGENTS` holds three lists. The sub-agent tool reads them when it starts a sub-agent, not
when it is built, so an extension that activates after `agents` (it must depend on it) still
reaches every child.

- `tools`: given to the main run as well, and to sub-agents (file tools, web tools).
- `taskTools`: tools that start background work (`run_command`). They are built once on the run's
  one task registry; what a call starts is owned by the session that made it. Having any means a
  sub-agent can inspect and cancel what it starts, even at the nesting limit.
- `hooks`: run by sub-agents too, each running its own `sessionStart`.

## Adding to it

Extend, don't edit: a new kind of tool for sub-agents is an extension that depends on `agents` and
shares it. Changing `agents.helper.ts` for one caller is the mistake.
See [the extensions guide](../../../.agents/skills/sheavly/extensions.md).
