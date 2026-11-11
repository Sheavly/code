# @sheavly/host

The services one run shares: `createHarness` makes the session, task and approval registries and
starts the main session, around the provider a UI picked (with `onModelCall` seeing every model
call). It adds no tools or hooks and reads no settings: a UI decides what a run includes and
composes it on these services. No UI, no project on disk.

```ts
import { createHarness } from '@sheavly/host/host/host.helper';

const harness = createHarness({ provider, title: prompt });
// harness: { provider, instructions, sessions, mainSession, tasks, approvals }
```

| Module           | What it holds                                                                |
| ---------------- | ---------------------------------------------------------------------------- |
| `host/`          | `createHarness`, and its `HarnessOptions` and `Harness` types                |
| `instructions/`  | `composeInstructions`: generic defaults or explicit replacement, then extras |
| `conversation/`  | `createConversation`: one conversation across prompts, in one session        |
| `conversations/` | `Conversations`: the live conversations a host serves, by id, and kept ones  |
| `errors/`        | `ConversationsError`: no such conversation, skill or model; storage failed   |

A UI the user keeps talking to wraps the harness in a conversation: each prompt continues from
the history so far, in the same session, idle between prompts until `close`. A failed prompt
keeps the user's message and completed tool work, rather than rolling back history while leaving
the tool effects on disk. Finite background tasks, including sub-agent replies, keep the prompt
running and wake the model automatically with their completions. Persistent services may outlive
the prompt without keeping it active. A `summary` option (`SummaryOptions`, `@sheavly/core`) is handed to
every prompt's run, so the loop summarizes the history when the context nears the window; the
host never picks a summarizer, the app does.

```ts
import { createConversation } from '@sheavly/host/conversation/conversation.helper';

const conversation = createConversation({ harness, run: streamAgent, tools, hooks });

for await (const event of conversation.send(prompt, { signal })) render(event);
await conversation.close();
```

A prompt cannot be given more text while it runs. A UI that queues what the user types calls
`conversation.yieldPrompt()` so the running prompt ends as `completed` at its completion point
instead of waiting for background tasks or sub-agents (their results reach the next prompt), then
sends the queued text with `send`. It returns `false` for an idle or stopping prompt, and
closed conversations throw `session_ended`.

A host serving several conversations (the HTTP server, or a UI in-process) keeps them in a
`Conversations`, built on a function the app gives that composes each one (provider, tools,
hooks, skills, and the `run` it reports: workspace, models and trust, for `details` and
`useModel`). The server only turns requests into these calls, so in-process and remote UIs
behave the same:

```ts
import { Conversations } from '@sheavly/host/conversations/conversations.service';

const conversations = new Conversations({ create: (options) => buildConversation(options) });
const id = await conversations.start();
const { events } = await conversations.send({ id, prompt: { text: 'hi' } });
// A UI with more input waiting asks the run to end at its completion point, then sends it.
conversations.yieldPrompt(id);
```

A coding UI uses `createCodingHarness` (`@sheavly/coding`), which builds on this.

The harness composes stable domain-neutral instructions. `instructions` in `HarnessOptions`
adds host extras; `baseInstructions` replaces only the generic core (an empty string omits it).
The default is deliberately small: task scope, approval/data boundaries, yielding for required
background results instead of polling, and concise, truthful communication. It contains no coding
recipes or model-specific overlays.
Conversations use `harness.instructions` by default. An explicit conversation `instructions`
string remains a complete override, including an empty string. Direct loop callers pass
`instructions: harness.instructions` themselves. See [instruction composition](docs/harness.md#instruction-composition).

`await conversations.useModel({ id, modelId, mode? })` changes one conversation's selection.
The app restores that model's remembered mode when omitted. Switches for one conversation are
serialized; a failed switch rejects its caller but does not block a later one. The main session
and stored index retain the selected mode. Reopening passes the saved model/mode pair to the app,
not the profile's more recent preference.

**Keeping conversations.** Give `Conversations` a `store` (`ConversationStore`,
`@sheavly/core/store/`) and every conversation is kept as it runs: its stream goes to the store
through the `storage` the host hands `create` (`entries` for `createHarness`, `keepHistory` for
`createConversation`), its history is written when a prompt starts and when it ends, and an index
entry says its title, model and whether it is open or closed. `listStored()` lists past
conversations (`listStored({ search })` those whose title has it, ignoring case), and `reopen(id)` brings one back under its own id, continuing from its history: its
stream is numbered on from the last stored entry, a tool call that never returned gets a
placeholder result, and a sub-agent that was running is `interrupted`. If storage fails, the
conversation takes no more prompts (`storage_failed`) instead of carrying on unrecorded. With no
store, nothing is kept and everything behaves as before.

## Docs

Normal prompts sent with `send` have stable UUID `id`s, persisted in history and attached to stream
entries as `messageId`. The ID is assigned before the resume update, so even early failures can be
linked to the right prompt. Providers never send these IDs to the model.

- [The services a run shares](docs/harness.md): what `createHarness` makes, and how a UI composes
  a run on it.
