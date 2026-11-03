# The chat

One conversation you keep talking to, in the terminal: `npm run dev -w @sheavly/terminal` (from
source) or `npm run start -w @sheavly/terminal` (built first, then plain Node), or `npm run dev` /
`npm run start` inside `apps/terminal`. `npm run dev -w @sheavly/terminal -- "first message"`
starts with that message. It works from the folder you start it in (`.env`, the default
workspace), and calls the real API, so it costs money. The root has no `dev` or `start`: each UI
has its own.

- Each message continues the same conversation (`createConversation`, see
  [the services a run shares](../../../packages/host/docs/harness.md#a-conversation-across-prompts)):
  the model sees the history so far, in one session, idle between messages.
- Background commands and sub-agents keep running between messages, and what finished meanwhile
  is reported at the next one.
- Ctrl+C stops the running message; history stays valid, and the next message continues from it.
  Pressed again while the message stops, it force-quits (after stopping what the conversation
  started); at the input line it quits. Either way, lines typed but not yet sent are dropped.
- `/model` lists the models `MODELS` sets up and `/model <name>` switches to one, from the next
  model call on, keeping the history ([several models](demo.md#several-models-on-azure)).
- `/exit`, `/quit` or Ctrl+D ends the conversation: it stops what it started (background
  commands, sub-agents) and ends the session. `/help` lists this.
- Lines are read in order, so lines typed (or piped in) while a message runs are sent after it.
- Closing the terminal window or `kill` (SIGHUP, SIGTERM) closes the conversation too, so its
  background commands don't outlive the chat. Only `kill -9` can't be caught.

The settings are the demo's ([the demo](demo.md#settings)); a conversation isn't kept across
restarts.
