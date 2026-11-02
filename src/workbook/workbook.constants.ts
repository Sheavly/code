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

/** Written as `.env` into every run workspace, so the `.env` guards have something to refuse. */
export const FAKE_ENV = 'SECRET=fake-workbook-secret\n';
