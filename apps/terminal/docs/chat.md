# The chat

One conversation you keep talking to, in the terminal: `npm run dev -w @sheavly/terminal` (from
source) or `npm run start -w @sheavly/terminal` (built first, then plain Node), or `npm run dev` /
`npm run start` inside `apps/terminal`. `npm run dev -w @sheavly/terminal -- "first message"`
starts with that message. It works from the folder you start it in (`.env`, the default
workspace), and calls the real API, so it costs money. The root has no `dev` or `start`: each UI
has its own.

- Each message continues the same conversation, on the [backend](demo.md#the-backend) the chat
  starts: the model sees the history so far, in one session, idle between messages. The chat is
  a UI like any other: it reaches the conversation only over HTTP, as an editor would.
- Background commands and sub-agents keep running between messages, and what finished meanwhile
  is reported at the next one.
- Ctrl+C stops the running message; history stays valid, and the next message continues from it.
  Pressed again while the message stops, it force-quits (after stopping what the conversation
  started); at the input line it quits. Either way, lines typed but not yet sent are dropped.
- `/model` lists the models `MODELS` sets up, with their ids, and `/model <id or name>` switches to
  one, from the next model call on, keeping the history
  ([several models](../../backend/docs/harness.md#several-models-on-azure)). The switch is made by
  id; a name only finds the model, and one that two models share is refused.
- `/<skill>` anywhere in a message runs that [skill](../../../packages/workspace/docs/skills.md)
  with the message, at the start (`/git submit`), in the middle or at the end
  (`review this, then /git`), including `disable-model-invocation` skills. A message that starts
  with a `/name` no skill has is reported as an unknown command and not sent. Skills that didn't
  load are listed, with why, when the chat starts. Tab after a `/` completes skill names (and,
  at the start of the line, the chat's commands); press it twice to list them.
- An approval a command asks for is refused at once: the chat doesn't answer approvals, so a
  command that needs one is skipped, and the model is told why.
- `/exit`, `/quit` or Ctrl+D ends the conversation: it stops what it started (background
  commands, sub-agents) and ends the session. `/help` lists this.
- Lines are read in order, so lines typed (or piped in) while a message runs are sent after it.
- Closing the terminal window or `kill` (SIGHUP, SIGTERM) closes the conversation and the
  backend too, so its background commands don't outlive the chat. A `kill -9` can't be caught,
  but the backend still stops: its stdin, a pipe from the chat, closes.

The settings are the demo's ([the demo](demo.md#settings)); a conversation isn't kept across
restarts.
