# Design

How the web extension works.

The tools themselves (`web_fetch`, `web_search`, their limits and backends) live in
`@sheavly/tools`; this extension only decides whether a run has them, and shares them with
sub-agents through `agents`. `false` for an option leaves that tool out of the main run and every
sub-agent alike. The app picks the concrete search backend, since backends are app-selected
modules (`sheavly.appOnlyModules`).

See [the extensions guide](../../../.agents/skills/sheavly/extensions.md).
