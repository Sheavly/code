# The chat

One conversation you keep talking to, in the terminal: `npm run dev:terminal` from the repo root
(from source), `npm run dev -w @sheavly/terminal`, or `npm run start -w @sheavly/terminal` (built
first, then plain Node), or `npm run dev` / `npm run start` inside `apps/terminal`.
`npm run dev:terminal -- "first message"` starts with that message. It works from the folder you
start it in (the default workspace), and calls the real API, so it costs money. The root has
`dev:terminal` but no plain `dev` or `start`: each UI has its own.

- Each message continues the same conversation, on the [backend](demo.md#the-backend) the chat
  starts: the model sees the history so far, in one session, idle between messages. The chat is
  a UI like any other: it reaches the conversation only over HTTP, as an editor would.
- **On a terminal it is a screen**, drawn on the terminal's main screen: what has happened scrolls
  up into the terminal's own history, so its scrollback, search and text selection keep working,
  and only the bottom is redrawn (the line being written, a question waiting for you, queued
  messages, a status line and the editor). The status line says what it is doing (`ready`,
  `working`, `waiting for you`), the model, the folder's permission mode (`allow all` in red) and
  how many background tasks run. Without a terminal (piped input, or `SHEAVLY_PLAIN=1`) it reads
  and writes lines, as it always did.
- **The conversation reads as a conversation.** Each message you send is shown after a `›`, then
  the reply as plain text, with a blank line between it and the steps around it. A step is one
  dim line (`⏺ Run the tests  $ npm test`) and its result under it (`⎿ ✓ … · 0.3s`, in red when
  it failed); the loop's bookkeeping (event counts, stop reasons, sub-agent ids) is left out, and
  only a problem is said: a reply cut off at the token limit, the turn limit, a stopped run. The
  demo and the workbook keep the complete plain log, which their saved runs and checks read.
- **A command you haven't allowed asks you.** It shows the command and why it asks, and four
  choices: run it once, always allow it (kept for this folder, [see permissions](../../backend/docs/api.md)),
  skip it (the model is told not to retry), or skip and type what to do instead (the model reads
  it as your direction). `↑↓` or `1`-`4` choose, `Enter` confirms, `Esc` skips. Nothing is chosen
  when the question appears, so an `Enter` meant for something else never runs a command; and as
  soon as you type into the editor, every key is the editor's and the question waits. Several
  questions wait in order, `+N more waiting` says how many. With a plain line chat there is no one
  to ask, so such a command is refused and the model told why.
- **Always allow shows what it saves.** Its hint lists the exact entries from the backend, such
  as `touch /path/file` or `npm run test *`, including every entry for a command chain. A two-word
  command like `touch /path/file` stays exact; it does not grant `touch *`. If a backend omits the
  entries, the choice keeps its generic hint. See the
  [entry rules](../../../packages/coding/docs/run-command.md#who-decides).
- **You can keep typing while it works.** What you send waits its turn and is shown as
  `⏳ N queued`; it is sent in order when the prompt ends. The editor takes several lines
  (`Shift+Enter`), keeps your history (`↑` at the top), completes `/` commands and skills with
  `Tab`, and folds a large paste into one marker.
- Background commands and sub-agents keep running between messages, and what finished meanwhile
  is reported at the next one.
- A message has no turn limit: the model keeps working until it is done, so Ctrl+C is how you stop
  one that goes on (`MAX_TURNS` in the backend's environment sets a cap if you want one).
- Ctrl+C stops the running message (and skips a question it waits on); history stays valid, and the
  next message continues from it. With nothing running, Ctrl+C asks to be pressed again to quit,
  so one stray press never ends the conversation. In the plain line chat, pressed again while the
  message stops, it force-quits (after stopping what the conversation started); at the input line
  it quits. Lines waiting are still sent after a stopped message; leaving drops them.
- `/model` lists the models of your profile, with their ids, and `/model <id or name>` switches to
  one, from the next model call on, keeping the history
  ([models and keys](../../backend/docs/harness.md#models-and-keys)). The switch is made by
  id; a name only finds the model, and one that two models share is refused.
- `/<skill>` anywhere in a message runs that [skill](../../../packages/workspace/docs/skills.md)
  with the message, at the start (`/git submit`), in the middle or at the end
  (`review this, then /git`), including `disable-model-invocation` skills. A message that starts
  with a `/name` no skill has is reported as an unknown command and not sent. Skills that didn't
  load are listed, with why, when the chat starts. Tab after a `/` completes skill names (and,
  at the start of the line, the chat's commands); press it twice to list them.
- `/exit`, `/quit` or Ctrl+D (on an empty line) ends the conversation: it stops what it started
  (background commands, sub-agents) and ends the session. `/help` lists this.
- Lines are read in order, so lines typed (or piped in) while a message runs are sent after it.
- Closing the terminal window or `kill` (SIGHUP, SIGTERM) closes the conversation and the
  backend too, so its background commands don't outlive the chat. A `kill -9` can't be caught,
  but the backend still stops: its stdin, a pipe from the chat, closes.

The settings are the demo's ([the demo](demo.md#settings)); a conversation isn't kept across
restarts.

## Setup

### Model modes

`/mode` shows the current reasoning effort. `/mode low`, `/mode medium`, `/mode high` and
`/mode extreme` change it, with the selection shown in the status line. The profile remembers
the mode for this model, separately from every other model. `/model` switches restore the
selected model's latest remembered mode, or medium when it has none. Existing conversations
and sub-agents retain their own selections; new conversations use the profile's latest pair.
Modes take effect at the next model call, not midway through a response.

On a workspace without a ready profile, the interactive chat opens setup before creating a
conversation. You can also open it explicitly with `npm run dev:terminal -- --setup`, including
when a profile already works.

1. Choose an existing profile or create one, such as Personal or Work.
2. Choose an existing model or add one. For a new model, choose a provider from the backend's
   installed adapters. The form asks only for required fields, using provider defaults for
   optional ones. It derives a display name from the model/deployment; use Edit model settings
   to rename it or change advanced values. Claude's output limit defaults to 8192. Reasoning
   effort defaults to medium until you select a mode.
3. Enter the settings and API key. The key is masked, including paste, and sent only to the
   write-only credential route. Existing keys are never loaded into an input or shown again.
   For Azure Claude models requiring adaptive thinking, choose **adaptive** under Thinking mode
   and leave Thinking budget empty. Max tokens is the output limit per reply, not the context
   window; use a value supported by the deployment, such as 8192.
4. Choose **Save and start chatting**, or **Test connection** to make a small provider API call.
   A failed check lets you replace the key or edit the model settings in the same screen.

The chosen profile is bound to this workspace; an existing default for other workspaces is kept.
The first profile also becomes the default. The selected model is used for the new conversation.
Reopen `--setup` to add more profiles or models, edit model settings, or replace a key. All writes
go through the [setup API](../../backend/docs/api.md#setting-the-backend-up), including when the
terminal connects to an existing backend.

Esc or Ctrl+C cancels setup and stops a backend this terminal started. Settings already saved
remain available to finish next time. An unconfigured chat with piped input exits with a short
instruction to run interactive setup first; it never consumes the piped text as a key. A ready
workspace goes directly to chat, with no setup questions.
