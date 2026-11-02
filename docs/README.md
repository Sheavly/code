# Sheavly harness docs

Notes for building on the harness: what exists, how the parts fit, and where new work goes.
The [README](../README.md) covers setup and running; open work is in [GitHub Issues](https://github.com/Sheavly/code/issues).

| Doc                        | What it covers                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| [vision.md](vision.md)     | Why the harness exists, the principles it follows, and the roadmap   |
| [overview.md](overview.md) | What the harness is for, its layers, and one run from start to end   |
| [tools.md](tools.md)       | How tools are written; the file tools and their before/after changes |
| [hooks.md](hooks.md)       | Every hook point, order rules, and `.sheavly/` project hooks         |
| [sessions.md](sessions.md) | Session ids and linking, sub-agents, status reporting, SSE streaming |

When a feature lands, update the doc it belongs to (or add one here) in the same change. Cursor's
stop hook reminds the agent: if source files changed but the doc that describes them didn't, it
asks once to update it. Which doc covers which files is `DOC_SOURCES` in
`.cursor/hooks/docs.utils.mjs`; a new doc gets an entry there.
