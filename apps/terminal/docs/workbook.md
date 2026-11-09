# The workbook

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

Runs use the real model, on your profile's models, like the demo.

## Layout

```
workbook/
  prompts/<name>.md          stored prompts (committed): replay them by name
  workspaces/<fixture>/      fixture projects (committed): copied fresh for each run
  workspaces/runs/<prompt>/  the workspace each prompt last ran in (git-ignored)
  runs/<id>/                 one folder per run (git-ignored)
  state.json                 run counter, last run, last run per prompt (git-ignored)
```

The code is `src/workbook/`; `workbook/` at the repo root is its data, read from the directory
you run it in (the root, through `npm run workbook`). Each run starts a backend of its own, on
that run's workspace, trust and turn limit, so it runs the same agent as the chat and the demo
([what a run includes](../../backend/docs/harness.md)), and prints with the same renderer.

## Stored prompts

A prompt is a markdown file. Optional front matter sets how it runs:

```markdown
---
description: write_file + edit_file, then read both back
workspace: basic # a fixture folder name in workspaces/ to copy for each run (default: an empty folder)
maxTurns: 20 # model calls per session (default: no limit)
contextWindow: 40000 # tokens every model is told it has (default: each model's own)
---

Create src/math.ts exporting a function add(a: number, b: number) …
```

`maxTurns` and `contextWindow` reach the run's backend as `MAX_TURNS` and `CONTEXT_WINDOW`
([serve](../../backend/docs/serve.md)). A small `contextWindow` lets a short run reach a limit
that a model's real window would take a very long one to reach, such as the point where the
conversation is summarized (`long-run-summary`).

A prompt's name and its `workspace` are single file names (letters, digits, `-`, `_`, `.`),
never paths, so a run can only read, copy and clear folders inside the workbook.

The included prompts cover the harness's features: `hooks-and-agents-md`, `write-and-edit`,
`guards`, `read-ranges`, `background-tasks`, `sub-agent-nesting`, `steer-sub-agent`, the
workspace-trust cases `trust-changed` and `trust-untrusted`, and the skills cases `skills` (the
model picks a skill and reads it) and `skill-mention` (a `/<skill>` in the middle of the prompt
runs it). Each has a `check`.

`complete-change` exercises investigation, repair and verification on an invoice fixture without
giving the model a tool-call recipe. It covers shared prompt composition; its success marker is
a smoke check, not a substitute for inspecting the saved changes in a comparative evaluation.

`checkout-discount` crosses imported calculation modules and preserves independent assertions
for the helper and final receipt. `checkout-plan-only` requires a diagnosis and repair plan with
no write or command requests. `staging-boundary` tests public configuration diagnosis against
quoted secret-access instructions in support data. Their smoke assertions do not replace
snapshot checks, exit-status validation or human review of the proposed fixes and approvals.

A prompt runs the skills it mentions (`/<name>` anywhere in it), as the chat does. A run reads
the workspace's skills and the built-in ones, never your `~/.agents/skills/`, so a check gives
the same result on every machine.

## Real-model checks

Unit tests use fakes, so they never show that a feature works with a real model. A **check** does:
it runs a stored prompt for real and compares what happened with what the prompt's front matter
says must (`expect`) and must not (`forbid`) show.

```bash
npm run workbook -- check                     # the checks whose areas this branch changed
npm run workbook -- check trust-changed       # named ones
npm run workbook -- check --all               # every one
```

It's manual and on demand, never part of CI or `npm run check`: every run is a paid model call
(roughly a cent each; a multi-step check makes a few). Run it once when a change to what a run
does is done. The `/git` review step asks for it, and the stop hook nudges once per set of files.

```markdown
---
workspace: basic
check:
  {
    'areas': ['packages/workspace/src/trust', 'packages/coding/src/preset'],
    'expect': { 'reply': ['[AGENTS.md OK]', '/Sheavly\W*$/'], 'tools': ['read_file'] },
    'forbid': { 'transcript': ['hooks not loaded'] },
  }
---
```

- **`check`** is JSON, or the YAML flow style Prettier rewrites it to (single quotes, trailing
  commas). It may go on over indented lines. No YAML library is needed.
- **`areas`**: source paths (`packages/workspace/src/trust`, a file or a folder) whose changes make the check
  relevant. `check` with no names runs only these, and lists changed source no check covers.
- **`expect` / `forbid`**: `transcript` (what was printed) and `reply` (the final answer) take
  substrings, or regexes written `/…/flags`. `events` (types such as `context_added`) and `tools`
  (names such as `read_file`) take names. `expect.outcome` is `completed`, `failed`, ….
- **`expect.adapter`** requires the adapter recorded in run metadata, not a model's claim about
  its identity. `deepseek-chat` requires `azure-chat`; run it with the corresponding configured
  DeepSeek model selected. Other transports cannot masquerade as coverage of the Chat protocol.
- **`toolResults`** maps tool names to expected or forbidden output patterns, for example
  `expect: { toolResults: { run_command: ['INVOICE_CHECK_OK'] } }`. It matches successful foreground
  result content from recorded events, not final-reply claims, another tool's output or renderer
  summaries. Failed results are excluded. Inspect denied attempts separately.
- **`toolErrors`** matches recorded failed foreground results by tool name, using the same map
  format. A forbidden protected-file denial fails a safety check even when a runnable check
  succeeded. `complete-change` forbids the `.env` read denial through `read_file`; this targeted
  regression does not replace inspecting other secret-access methods or successful disclosure.
- **`contextHooks`** takes hook names from structured `context_added` events. For example,
  `forbid: { "contextHooks": ["house-rules"] }` rejects that project hook without rejecting
  built-in AGENTS.md or skills context. Trusted steps can require the same hook through `expect`.
- **`steps`**, for a check that needs several runs, replace the top-level `expect` / `forbid`:
  - `{ "run": { "keep": true, "trust": true, "text": "…" }, "expect": …, "forbid": … }` is a run, with
    the same flags as the command line;
  - `{ "append": { "file": "…", "text": "…" } }` edits the workspace between runs (through the
    sandbox);
  - `{ "untrust": true }` forgets the workspace's trust.

  `trust-changed` uses all three: trusted, then a hook edited, then skipped, then trusted again.

A failed check is retried once, since real models aren't fully repeatable. The report marks a
check that passed only on its retry (`~`), and lists every run it made for `show` and `step`.
Each attempt uses a throwaway trust file, never your `~/.config`; each run's backend reads it. The command exits 1 when a
check fails.

Workbook checks use the plain log renderer, not the interactive chat screen. They cannot verify
React layout, editing, approval key handling or terminal resize behavior. Those are covered by
the terminal app's component and interaction tests, with PTY checks for native scrollback;
adding their paths to a prompt's `areas` would select a model run without exercising that UI.

## What a run saves

Each file in `runs/<id>/` is written while the run goes, so a crash keeps everything up to that
point (only `result.json` is then missing, which marks the run unfinished):

| File                | What it holds                                                                |
| ------------------- | ---------------------------------------------------------------------------- |
| `run.json`          | The prompt, model, workspace, main session id and git commit. Written first  |
| `events.jsonl`      | Every loop event of the main session, one per line, in `seq` order           |
| `model-calls.jsonl` | Every model call (main session and sub-agents), written by the run's backend |
| `sessions.sse`      | The conversation's stream (`QUERY /stream`), byte for byte, as a UI reads it |
| `transcript.txt`    | The terminal output, exactly as printed                                      |
| `messages.json`     | The final conversation, which `continue` starts from                         |
| `result.json`       | Outcome (or error), duration, and counts of events, calls, sessions          |

A `done` in `events.jsonl` doesn't carry the conversation (the stream never does);
`messages.json` has it, and `show`, `diff` and the checks read the final answer from there. Runs
saved before the stream, whose `done` still has its messages, read the same.

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
transcript. See [workspace trust](../../../packages/workspace/docs/project-hooks.md#workspace-trust).

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
