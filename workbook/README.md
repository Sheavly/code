# Workbook

A stateful place to run, replay and inspect the harness. Every run is saved as it happens, so
you can always see what the last one did, continue it, or step through it when something broke.

```bash
npm run workbook -- list                       # stored prompts, and the latest runs
npm run workbook -- run write-and-edit         # run a stored prompt
npm run workbook -- show                       # what the last run did, and its files
npm run workbook -- step                       # walk its events one at a time
npm run workbook -- continue "now add tests"   # follow up on the last run, with its history
npm run workbook -- diff 0003 0007             # compare two runs
```

Runs use the real model, with the same settings as the demo (`ADAPTER`, keys, `.env`).

## Layout

```
workbook/
  prompts/<name>.md          stored prompts (committed): replay them by name
  workspaces/<fixture>/      fixture projects (committed): copied fresh for each run
  workspaces/runs/<prompt>/  the workspace each prompt last ran in (git-ignored)
  runs/<id>/                 one folder per run (git-ignored)
  state.json                 run counter, last run, last run per prompt (git-ignored)
```

The code is in `src/workbook/`. It's a host like `src/demo.ts`, and shares its wiring and
terminal output with it (`src/host/`).

## Stored prompts

A prompt is a markdown file. Optional front matter sets how it runs:

```markdown
---
description: write_file + edit_file, then read both back
workspace: basic # a fixture in workspaces/ to copy for each run (default: an empty folder)
maxTurns: 20 # model calls per session (default 20)
---

Create src/math.ts exporting a function add(a: number, b: number) …
```

The included prompts cover the harness's features, the same checks as the live demo test:
`hooks-and-agents-md`, `write-and-edit`, `guards`, `read-ranges`, `background-tasks`,
`sub-agent-nesting`, `steer-sub-agent`.

## What a run saves

Each file in `runs/<id>/` is written while the run goes, so a crash keeps everything up to that
point (only `result.json` is then missing, which marks the run unfinished):

| File                | What it holds                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| `run.json`          | The prompt, model, workspace, main session id and git commit. Written first   |
| `events.jsonl`      | Every loop event, one per line, in `seq` order: what a UI would receive       |
| `model-calls.jsonl` | Every model call (main session and sub-agents): instructions, messages, tools |
| `sessions.sse`      | The session registry's server-sent event stream, byte for byte                |
| `transcript.txt`    | The terminal output, exactly as printed                                       |
| `messages.json`     | The final conversation, which `continue` starts from                          |
| `result.json`       | Outcome (or error), duration, and counts of events, calls, sessions           |

## Picking up where the last run left off

- **`continue [run] "<text>"`** starts from that run's conversation, in that run's workspace,
  so the agent knows what it did and sees its own files. Without a run, it's the last one.
- **`run <prompt> --continue <run>`** does the same with a stored prompt as the next message.
- **`run <prompt> --keep`** reuses the prompt's last workspace instead of a fresh copy, so work
  builds up across runs (without the old conversation).

A fresh copy of a committed fixture is trusted, so its `.sheavly/` hooks run: it's this repo's
own code. A kept (`--keep`) or continued workspace isn't trusted automatically, since the agent
may have edited its hooks. Add `--trust` to run them anyway (`run <prompt> --keep --trust`,
`continue --trust "<text>"`). A run whose hooks were skipped says so at the top of its
transcript. See [docs/hooks.md](../docs/hooks.md#workspace-trust).

- Every run gets the next number (`0001-…`, `0002-…`), so `list` and `diff` read in order.
  Run ids can be shortened to their number: `show 7`, `diff 3 7`.

## When something breaks

1. `show` gives the outcome, the error, and the last event before it ended.
2. `step [run]` walks the events: Enter for the next, a number to jump to that `seq`, `j` for
   the full JSON of the current event, `q` to quit. `--from N` starts at an event.
3. `model-calls.jsonl` has exactly what the model was sent at each step, including the system
   prompt and every sub-agent's calls.
4. Fix it, rerun the same prompt, and `diff` the two runs.

`--model-calls` prints every model call during a run, like the demo's `SHOW_MODEL_CALLS`.
