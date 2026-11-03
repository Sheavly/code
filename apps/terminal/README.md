# @sheavly/terminal

The terminal front end, with three entry points over the same harness and renderer:

```bash
npm run dev -w @sheavly/terminal                                   # a conversation you keep talking to
npm run demo -- "Read package.json and tell me the project name"   # one prompt, printed as it happens
npm run workbook -- list                                           # stored prompts and saved runs
```

All three call the real model API and cost money (a fraction of a cent for a short prompt). Settings
come from the environment, or `.env` at the root (`ADAPTER`, the backend's keys, `MODEL`).

| Folder      | What it holds                                                                    |
| ----------- | -------------------------------------------------------------------------------- |
| `harness/`  | What a terminal run includes (`createTerminalHarness`) and its settings from env |
| `render/`   | The `Renderer` every entry point prints a run with, through a `write` function   |
| `workbook/` | The workbook CLI: stored prompts, saved runs, continue, step, diff and checks    |
| `chat/`     | The chat's input commands (`/exit`, `/help`)                                     |
| `chat.ts`   | The chat CLI: one conversation across prompts                                    |
| `demo.ts`   | The demo CLI                                                                     |

This is where the terminal's choices live: which backend and model (`harness.constants.ts`),
which tools and hooks a run gets (`harness.helper.ts`), and where trust is remembered. Another
UI makes its own.

## Docs

- [The chat](docs/chat.md): one conversation across prompts, and how to stop or end it.
- [The demo](docs/demo.md): its settings.
- [The workbook](docs/workbook.md): stored prompts, saved runs, checks, and the `workbook/` folder.
- [What a terminal run includes](docs/harness.md): the tools, hooks and settings, and why here.
