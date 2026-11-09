# @sheavly/terminal

The terminal front end, with three entry points on [the backend](../backend/README.md): each
starts a backend of its own (or connects to one running, `BACKEND_URL`), talks to it over HTTP
like any other UI, and stops it on the way out.

```bash
npm run dev -w @sheavly/terminal                                   # a conversation you keep talking to
npm run dev:terminal -- --setup                                    # add or update profiles, models and keys
npm run dev:terminal -- --resume <conversation-id>                  # reopen a saved conversation
npm run demo -- "Read package.json and tell me the project name"   # one prompt, printed as it happens
npm run workbook -- list                                           # stored prompts and saved runs
```

The chat guides an unconfigured workspace through setup before opening its first conversation:
choose a profile, the model to add, then a supported hosting provider. Enter connection settings
and a masked key, then start chatting. No
config files need editing. `--setup` opens the same UI again for another model or profile, or to
replace a key. Setup uses the backend API; a connection check is an explicit choice.

The backend supplies the model catalogue: Sol, Astra, Luna, Opus, Sonnet and DeepSeek Flash,
with only implemented compatible hosting routes. **Custom model** accepts another model identity
and any registered adapter. Azure asks for a deployment name separately; native model IDs are
already chosen. Existing models and keys need no migration. See [model setup](docs/chat.md#model-first-setup).

To extend the picker, update the [backend's model catalogue](../backend/src/profiles/model-catalog.constants.ts)
and its compatible hosting policy, not a second list in this UI. The setup API supplies the choices.

Workbook checks can require the adapter recorded in run metadata with `expect.adapter`.
The `deepseek-chat` check requires `azure-chat`; it cannot pass on a different transport just
because the model claims that identity. See [real-model checks](docs/workbook.md#real-model-checks).
For executable check markers, `expect.toolResults` inspects recorded successful tool output,
even when the renderer shows only its size. A final-reply claim cannot satisfy that assertion.
`forbid.toolErrors` can also reject recorded denied attempts, so a working guard does not hide
an unsafe model decision behind an otherwise passing check.

Prompts call the real model API and cost money (a fraction of a cent for a short prompt).
They run on the models and keys in your profile (`~/.sheavly`, see
[models and keys](../backend/docs/harness.md#models-and-keys)); the other settings come from the
environment and go to the backend it starts ([the backend's settings](../backend/docs/serve.md#settings)).
`WEB_FETCH=false` disables public web reading for the main agent and sub-agents. It is enabled
by default and validated by the backend; when connecting to an existing backend, use its setting.

| Folder          | What it holds                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `client/`       | Reaching a backend (`connectBackend`), one conversation on it over HTTP (`RemoteConversation`)           |
| `render/`       | The `Renderer` every entry point prints a conversation's stream with, in a look: the chat's or the log's |
| `tui/`          | The chat's input and approval controller, shared editor, and classic screen fallback                     |
| `react-screen/` | React/Ink rendering: append-only native scrollback and a bounded live footer                             |
| `markdown/`     | A streamed reply drawn as Markdown: a block at a time, a code fence line by line (`MarkdownStream`)      |
| `diff/`         | A file change as rows (`buildDiff`, `countChanges`) and as styled lines (`formatDiff`)                   |
| `changes/`      | Every file change a chat made (`ChangeLog`), shown collapsed, listed or in full (`/changes`, Ctrl+O)     |
| `failures/`     | Failed steps with more to say than their first line (`FailureLog`): collapsed, `/errors`, Ctrl+O         |
| `marks/`        | OSC 133 turn markers: what stands for one through Ink, and the stdout that restores them                 |
| `links/`        | OSC 8 hyperlinks: the `SHEAVLY_HYPERLINKS` setting and file links                                        |
| `theme/`        | The colour of each role (`status.error`, `diff.added`...) per theme, and the `Palette` that paints them  |
| `bell/`         | Opt-in terminal alerts for reply completion, approvals and long-running tools (`TerminalBell`)           |
| `usage/`        | Latest main-session context usage and cumulative estimated USD cost for the status line                  |
| `setup/`        | Guided profile, provider, model and credential setup through the backend's API                           |
| `workbook/`     | The workbook CLI: stored prompts, saved runs, continue, step, diff and checks                            |
| `chat/`         | The chat's logic (`ChatSession`: queue, stop, commands), its line mode, and Tab completion               |
| `chat.ts`       | The chat CLI: one conversation across prompts                                                            |
| `demo.ts`       | The demo CLI                                                                                             |

The terminal makes no choice about a run: which model, tools and hooks it gets is the backend's
([what a run includes](../backend/docs/harness.md)). The terminal decides how to show it.

Interactive chat uses React and Ink. `SHEAVLY_TUI=classic` selects the previous renderer;
`SHEAVLY_PLAIN=1` keeps linear input and output. Both interactive renderers share the editor,
completion, paste folding, queue and approval decisions. `SHEAVLY_THEME=colorblind` swaps the
colours that tell success from failure for ones that stay apart in red-green colour blindness
([colours](docs/chat.md)); `NO_COLOR` removes styling from the React screen.
`SHEAVLY_HYPERLINKS=1|0` forces OSC 8 links on or off; otherwise they follow the terminal
([links and turn markers](docs/chat.md)).
Reduced motion is global: in `--setup`, choose **Terminal settings** in the profile menu.
It replaces the spinner with a static marker while elapsed times update once per second.
The preference is stored in `~/.sheavly/config.json`, shared by every profile. Legacy profile
preferences migrate automatically when an interactive chat opens.
The same menu has **Terminal bell**, off by default. When enabled, it rings for completed replies,
new approvals and tools that reach five seconds. Both interactive renderers support it; plain
and piped output stay silent.
The interactive status line shows the main session's latest input plus output against its configured
context window, not cumulative billed tokens. Estimated cost still includes sub-agents and resumed
history. Window labels match model setup (`300K` and `1M`). Missing context usage shows `?`;
unknown cost is omitted entirely. A failed main run is
reported visibly, even when the stream ends without a final reply.

Structured `harness_notice` events are intentionally omitted from the conversation transcript.
Output-continuation notices leave streamed replies open, with no continuation line or cutoff marker.
The status line continues to use usage data; another UI can present notices differently without
changing the backend or interpreting model-facing text.

## Docs

Model failures show the reported cause and originating message ID instead of a generic error.
Kept conversations have a private `errors.jsonl` for correlating failures with stored messages;
see [chat diagnostics](docs/chat.md#chat-diagnostics). Restart a backend after updating its source.

- [The chat](docs/chat.md): one conversation across prompts, and how to stop or end it.
- [The demo](docs/demo.md): its settings, and how the terminal reaches its backend.
- [The workbook](docs/workbook.md): stored prompts, saved runs, checks, and the `workbook/` folder.
