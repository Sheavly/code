# Vision

Where the harness is going and why. The other docs describe what exists; this one says what it is
for, so new work can be checked against it.

## Why it exists

Cursor, OpenCode, Claude Code, Codex and the like are closed where it matters:

- **No control over the loop.** What goes into context, when to compact, which tools the model
  sees, when to stop and how to retry are decided for you.
- **Bugs you can't fix.** When the tool misbehaves you can't read the code path, reproduce it or
  patch it; you wait for a release.
- **Closed UIs.** The agent and its UI ship together. You can't drive the agent from another
  editor, a web page or your own tool.
- **Pricing.** Subscriptions, markups and opaque limits instead of your own key at the provider's
  price, with no clear view of what a run cost.

## The goal: the VSCode of agent harnesses

VSCode won by architecture, not features: a small core, built-in features that use the same API as
extensions, a protocol (LSP) that decoupled language smarts from the editor, and configuration that
lives in the repo. The harness takes the same shape, for agents of any kind: **a small core,
everything else an extension, and any UI a client.** Coding is the first extension built on it
(the `coding` extension, which a coding UI composes), not the point of the core: a text extractor or a chat wrapper uses the
same loop, tools and hooks without a repo in sight.

| VSCode                          | Sheavly                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Small core, extension API       | `@sheavly/core`: `defineTool`, `defineAdapter`, `defineHook`                    |
| Built-ins use the public API    | Built-in tools, adapters and hooks are written against `@sheavly/core` only     |
| LSP: one server, every editor   | The harness is a backend: typed events and registries, any UI is a client       |
| `.vscode/` settings in the repo | `.sheavly/`: project hooks, and later rules, skills, tools and policies         |
| Workspace Trust                 | Approvals and `Workspace` path confinement as first-class, declared permissions |
| Marketplace                     | Tools, hooks and adapters as installable packages                               |

In one line: **your loop, your keys, your UI. Every decision the agent makes is a hook you can
change, and every run is a file you can replay.**

## Principles

1. **Every loop decision is visible and replaceable.** If the loop decides something, a hook can
   see it and change it. A first-party feature that needs a private shortcut means the API is
   missing something; add the API, not the shortcut.
2. **Bugs are reproducible.** A run can be recorded and replayed without calling a model, so a bug
   report is a file, and a fix comes with a test built from it.
3. **The harness renders nothing.** It speaks a documented, versioned protocol; terminal, editor,
   web and desktop front ends are all clients of it.
4. **You pay the provider, nothing else.** Bring your own key or a local model. Every model call
   reports its cost, budgets are enforceable, and cheaper models can do cheaper work (sub-agents).
5. **Provider-neutral.** Nothing in the loop assumes one vendor's tool-call format, reasoning or
   caching behaviour; adapters absorb the differences.
6. **A stable core.** Once others build on `@sheavly/core`, breaking it breaks them. Change it
   deliberately, versioned, and keep experimental APIs apart from stable ones.
7. **Generic packages never know about files, workspaces or code.** The protocol, the core, the
   providers, the loop and the generic runtime and tools work for any LLM project. Everything that
   needs a project on disk or a coding tool lives in coding packages that only a coding UI
   reaches. Each workspace declares which it is (`sheavly.domain` in its `package.json`) and lint
   holds the graph to it: a generic workspace that depends on a coding one fails.

## Risks

- **A platform with no killer use.** VSCode shipped as a good editor first. The harness has to be
  the best way to run a coding agent for its own author before it is a platform for anyone else.
- **API churn.** Contracts in `@sheavly/core` should settle before others depend on them.

## Roadmap

Grouped by the complaint each item answers. Open work is in
[GitHub Issues](https://github.com/Sheavly/code/issues).

**Control over the loop**

- Hooks that rewrite the messages sent to each model call, which summaries can build on (#55)
- Summaries of long histories (#13, #14) and their hooks (#15); [research and design](summary/README.md)
- More hook points, matching Cursor's (#26); `onError` recovery (#12); user-level hooks (#10)
- Interactive runs: wait for, queue and steer user input (#16); rewind history (#20)
- The agent sees its context window size and usage (#37)

**Bugs you can fix**

- Record a run to a file and replay it without a model (#54)
- Fail loudly everywhere (#34)

**Install it and run it**

- Published packages, a `sheavly` command and one always-on backend per user that every front end
  connects to (#387); [the decisions](shipping.md)

**Open UIs**

- UI-ready events and one ordered stream of every session (#21, #22, #23), served over SSE (#24)
- The host protocol written down as a versioned spec (#56)
- An Agent Client Protocol host, so existing editors can drive the harness (#57)

**Pricing**

- Every model call and run reports what it cost (#53)
- Budgets: stop or ask for approval when a run passes a limit (#59)
- Local models through an OpenAI-compatible server (#58)
- A model per sub-agent (#60)
