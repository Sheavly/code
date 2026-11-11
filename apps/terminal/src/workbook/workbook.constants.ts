/** The workbook folder at the repo root: prompts (committed), runs and state (git-ignored). */
export const WORKBOOK_DIR = 'workbook';

/** Stored prompts: one `<name>.md` each, replayed by name. */
export const PROMPTS_DIR = 'prompts';

/** One folder per run: `runs/<id>/`. */
export const RUNS_DIR = 'runs';

/** Scratch projects the agent works in; each run gets a fresh copy, or keeps the last one. */
export const WORKSPACES_DIR = 'workspaces';

/** Which changed files need a real-model check: read by `check` and by the stop hook. */
export const RUN_SOURCES_FILE = 'run-sources.json';

/** The workbook's memory between runs: the last run per prompt, and run counters. */
export const STATE_FILE = 'state.json';

/** What a run folder holds. Every file is written as the run goes, so a crash keeps them. */
export const RUN_FILES = {
  /** What ran: prompt, settings, workspace, session ids. Written first. */
  meta: 'run.json',
  /** Every loop event, one JSON object per line, in `seq` order. */
  events: 'events.jsonl',
  /** Every model call: the full request (instructions, messages, tool names). */
  modelCalls: 'model-calls.jsonl',
  /** The session registry's server-sent event stream, byte for byte. */
  sessions: 'sessions.sse',
  /** The terminal output, exactly as printed. */
  transcript: 'transcript.txt',
  /** The final conversation, valid to continue from. */
  messages: 'messages.json',
  /** How it ended: reason or error, duration, counts. Written last. */
  result: 'result.json',
} as const;

/** The state file's version; bump it when its shape changes. */
export const STATE_VERSION = 1;

/** The state before any run. */
export const EMPTY_STATE = {
  version: STATE_VERSION,
  runCount: 0,
  lastRunByPrompt: {},
} as const;

/** A check is retried once: real models aren't fully repeatable, so one bad answer can be noise. */
export const ATTEMPTS = 2;

/** The base the branch is compared to, for which checks are relevant. */
export const BASE = 'origin/main';

/** The workbook command's help text. */
export const USAGE = `Usage: npm run workbook -- <command>

  run <prompt>             run a stored prompt (workbook/prompts/<prompt>.md) in a fresh workspace
    --continue <run|last>  start from that run's history and workspace instead
    --keep                 reuse the prompt's last workspace instead of a fresh copy
  ask "<text>"             run a one-off prompt (saved like any other run)
  continue [run] "<text>"  send a follow-up to a run (default: the last one), with its history
  check [prompt…] [--all]  run the real-model checks: the named prompts, else the ones whose
                           areas this branch changed (--all: every one). Costs model calls.
    --approve-command <base> explicitly authorize a base for this check's conversations (repeatable;
                           default: none; never persisted; no-command steps remain unapproved)
  list                     every stored prompt, and the last runs
  show [run]               a run's summary, result and files (default: the last one)
  step [run] [--from N]    walk a run's events one at a time (Enter: next, q: quit)
  diff <run-a> <run-b>     compare two runs: outcome, counts, tools used, final answer

  --model-calls            also print every model call (tools, system prompt, latest message)
  --trust                  trust the workspace's .sheavly/ hooks (a fresh fixture copy already is)

Runs are saved in workbook/runs/<id>/ as they happen; "last" means the most recent run.`;

/** Written as `.env` into every run workspace, so the `.env` guards have something to refuse. */
export const FAKE_ENV = 'SECRET=fake-workbook-secret\n';
