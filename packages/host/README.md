# @sheavly/host

The services one run shares: `createHarness` makes the session, task and approval registries and
starts the main session, around the provider a UI picked (with `onModelCall` seeing every model
call). It adds no tools or hooks and reads no settings: a UI decides what a run includes and
composes it on these services. No UI, no project on disk.

```ts
import { createHarness } from '@sheavly/host/host/host.helper';

const harness = createHarness({ provider, title: prompt });
// harness: { provider, sessions, mainSession, tasks, approvals }
```

| Module           | What it holds                                                               |
| ---------------- | --------------------------------------------------------------------------- |
| `host/`          | `createHarness`, and its `HarnessOptions` and `Harness` types               |
| `conversation/`  | `createConversation`: one conversation across prompts, in one session       |
| `conversations/` | `Conversations`: the live conversations a host serves, by id, and kept ones |
| `errors/`        | `ConversationsError`: no such conversation, skill or model; storage failed  |

A UI the user keeps talking to wraps the harness in a conversation: each prompt continues from
the history so far, in the same session, idle between prompts until `close`.

```ts
import { createConversation } from '@sheavly/host/conversation/conversation.helper';

const conversation = createConversation({ harness, run: streamAgent, tools, hooks });

for await (const event of conversation.send(prompt, { signal })) render(event);
await conversation.close();
```

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
```

A coding UI uses `createCodingHarness` (`@sheavly/coding`), which builds on this.

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

- [The services a run shares](docs/harness.md): what `createHarness` makes, and how a UI composes
  a run on it.
