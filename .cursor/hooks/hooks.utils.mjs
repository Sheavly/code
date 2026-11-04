// Shared helpers for the Cursor hooks in this folder. Hooks talk JSON over stdin/stdout:
// Cursor writes the event payload to stdin and reads our response from stdout.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { DateTime } from 'luxon';
import { RULE_HINTS } from '../../packages/eslint-config/src/rule-hints.js';
import { GuardCrashError, HookStateError, isMissingPath } from './hooks.errors.mjs';

/** Project hooks run from the project root. */
export const PROJECT_ROOT = process.cwd();

/**
 * The current time in epoch milliseconds, read through Luxon. The hooks run before anything is
 * built, so they can't use `now()` from `@sheavly/core`; this is their one clock, so a test can
 * pass a time in (`now = hookNow()` defaults) and nothing reads `Date` directly.
 */
export function hookNow() {
  return DateTime.now().toMillis();
}

/** Files ESLint checks (see eslint.config.js). */
export const LINTABLE = /\.(ts|js|mjs)$/;

/** Files Prettier formats (see .prettierrc.json / .prettierignore). */
export const FORMATTABLE = /\.(ts|js|mjs|json|md)$/;

export async function readHookInput() {
  let raw = '';

  for await (const chunk of process.stdin) raw += chunk;

  return raw ? JSON.parse(raw) : {};
}

export function respond(output) {
  process.stdout.write(JSON.stringify(output));
}

/** Edit tools name their target differently, so accept every known key. */
export function getEditedFilePath(toolInput) {
  const input = typeof toolInput === 'string' ? JSON.parse(toolInput) : (toolInput ?? {});
  const candidate = input.file_path ?? input.path ?? input.target_file;

  if (typeof candidate !== 'string') return null;

  return path.resolve(PROJECT_ROOT, candidate);
}

/** Inside the project and not in node_modules or build output. */
export function isProjectSource(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }

  return !/^(node_modules|dist|coverage)[/\\]/.test(relative);
}

/** Runs a project-local binary (node_modules/.bin) and captures its output; never throws. */
export function runBin(name, args) {
  return runFile(path.join(PROJECT_ROOT, 'node_modules', '.bin', name), args);
}

/** Runs an npm script quietly (so its own config and wrappers apply); never throws. */
export function runNpmScript(name) {
  return runFile('npm', ['run', '--silent', name]);
}

/** The checked-out branch in `cwd`, or null (detached HEAD, not a repo). */
export function currentBranch(cwd = PROJECT_ROOT) {
  const result = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' });
  const branch = result.status === 0 ? result.stdout.trim() : '';

  return branch || null;
}

// Per-chat state (the chat's issue, its approvals), outside the repo so it is never committed.
// SHEAVLY_HOOK_STATE_DIR points tests at a temp dir.
const STATE_DIR =
  process.env.SHEAVLY_HOOK_STATE_DIR ??
  path.join(os.homedir(), '.cache', 'sheavly-harness', 'chats');

function chatStateFile(conversationId) {
  return path.join(STATE_DIR, `${String(conversationId).replace(/[^\w-]/g, '_')}.json`);
}

/** What earlier hooks recorded for this chat, or null when nothing was recorded yet. */
export function getChatState(conversationId) {
  if (!conversationId) return null;

  const file = chatStateFile(conversationId);

  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return null; // a new chat: nothing recorded yet
    throw new HookStateError({ file, cause: caughtError });
  }
}

/** Merges `fields` into this chat's recorded state. */
export function updateChatState(params) {
  const { conversationId, ...fields } = params;

  if (!conversationId) return;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    chatStateFile(conversationId),
    JSON.stringify({ ...getChatState(conversationId), ...fields }),
  );
}

/**
 * Every chat's recorded state as `{ id, state }`, `id` its state file's name. A state that can't
 * be read is left out, never thrown: it is that chat's to report, and leaving it out only means
 * its edits and links are not seen (as if it had recorded none).
 */
export function listChatStates() {
  let names;

  try {
    names = readdirSync(STATE_DIR).filter((name) => name.endsWith('.json'));
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return []; // no chat has recorded anything yet
    throw caughtError;
  }

  return names.flatMap((name) => {
    try {
      const state = JSON.parse(readFileSync(path.join(STATE_DIR, name), 'utf8'));

      return [{ id: name.slice(0, -'.json'.length), state }];
    } catch (caughtError) {
      if (isMissingPath(caughtError) || caughtError instanceof SyntaxError) return [];
      throw caughtError;
    }
  });
}

/** The id `conversationId`'s state is stored under, as `listChatStates` names it. */
export function chatStateId(conversationId) {
  return path.basename(chatStateFile(conversationId), '.json');
}

function runFile(file, args) {
  const result = spawnSync(file, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  // It never started (missing binary, no permission): say so, rather than an empty failure.
  if (result.error) return { ok: false, output: `Could not run ${file}: ${result.error.message}` };

  return { ok: result.status === 0, output };
}

/**
 * Runs a guard hook's `check` and responds with its decision. If the guard itself fails, it
 * denies with a `GuardCrashError` saying why, so a broken guard never lets an action through
 * silently (`failClosed` in hooks.json covers a crash before this runs).
 */
export async function runGuard(params) {
  const { guard, check, deny } = params;

  try {
    respond(await check());
  } catch (caughtError) {
    respond(deny(new GuardCrashError({ guard, cause: caughtError }).message));
  }
}

/** ESLint's JSON report as readable lines: `src/a.ts:12:3  message  (rule)`. */
export function formatEslintReport(json) {
  const lines = [];

  for (const file of JSON.parse(json)) {
    const relative = path.relative(PROJECT_ROOT, file.filePath);

    for (const { line, column, message, ruleId } of file.messages) {
      const problem = `${relative}:${line}:${column}  ${message}  (${ruleId ?? 'parse error'})`;
      const hint = ruleId && RULE_HINTS[ruleId];

      lines.push(hint ? `${problem}\n  → ${hint}` : problem);
    }
  }

  return lines;
}

/** A task's own line: `@sheavly/core:lint: …` (the root package is `//`), not turbo's `pkg#task:`. */
const TURBO_TASK_LINE = /^[^\s#]+:\S+: (.*)$/;
/** What npm and turbo add around a task's own output. */
const TURBO_NOISE = /^(npm (notice|error) |cache (miss|hit|bypass)|\s*$)/;

/**
 * turbo's `--output-logs=errors-only` report cut to what the failing tasks' tools printed (no npm
 * lifecycle lines, no turbo progress), plus its `Failed:` line. Falls back to the whole output
 * when it has no task line in it (turbo itself failed to start).
 */
export function formatTurboReport(output) {
  const kept = [];

  for (const line of stripVTControlCharacters(output).split('\n')) {
    const task = TURBO_TASK_LINE.exec(line);

    if (task && !TURBO_NOISE.test(task[1] ?? '')) kept.push(line);
    else if (line.startsWith('Failed:')) kept.push(line.trim());
  }

  return kept.length > 0 ? kept.join('\n') : output;
}
