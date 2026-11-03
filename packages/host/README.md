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

| Module          | What it holds                                                         |
| --------------- | --------------------------------------------------------------------- |
| `host/`         | `createHarness`, and its `HarnessOptions` and `Harness` types         |
| `conversation/` | `createConversation`: one conversation across prompts, in one session |

A UI the user keeps talking to wraps the harness in a conversation: each prompt continues from
the history so far, in the same session, idle between prompts until `close`.

```ts
import { createConversation } from '@sheavly/host/conversation/conversation.helper';

const conversation = createConversation({ harness, run: streamAgent, tools, hooks });

for await (const event of conversation.send(prompt, { signal })) render(event);
await conversation.close();
```

A coding UI uses `createCodingHarness` (`@sheavly/coding`), which builds on this.

## Docs

- [The services a run shares](docs/harness.md): what `createHarness` makes, and how a UI composes
  a run on it.
