# @sheavly/terminal

The terminal front end, with three entry points on [the backend](../backend/README.md): each
starts a backend of its own (or connects to one running, `BACKEND_URL`), talks to it over HTTP
like any other UI, and stops it on the way out.

```bash
npm run dev -w @sheavly/terminal                                   # a conversation you keep talking to
npm run demo -- "Read package.json and tell me the project name"   # one prompt, printed as it happens
npm run workbook -- list                                           # stored prompts and saved runs
```

All of them call the real model API and cost money (a fraction of a cent for a short prompt).
Settings come from the environment, or `.env` at the root, and go to the backend it starts
(`ADAPTER`, the backend's keys, `MODEL`; [the backend's settings](../backend/docs/serve.md#settings)).

| Folder      | What it holds                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `client/`   | Reaching a backend (`connectBackend`), one conversation on it over HTTP (`RemoteConversation`)   |
| `render/`   | The `Renderer` every entry point prints a conversation's stream with, through a `write` function |
| `workbook/` | The workbook CLI: stored prompts, saved runs, continue, step, diff and checks                    |
| `chat/`     | The chat's input commands (`/exit`, `/help`, `/model`) and Tab completion                        |
| `chat.ts`   | The chat CLI: one conversation across prompts                                                    |
| `demo.ts`   | The demo CLI                                                                                     |

The terminal makes no choice about a run: which model, tools and hooks it gets is the backend's
([what a run includes](../backend/docs/harness.md)). The terminal decides how to show it.

## Docs

- [The chat](docs/chat.md): one conversation across prompts, and how to stop or end it.
- [The demo](docs/demo.md): its settings, and how the terminal reaches its backend.
- [The workbook](docs/workbook.md): stored prompts, saved runs, checks, and the `workbook/` folder.
