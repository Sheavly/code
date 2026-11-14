// Runs the Cursor hook scripts in `.cursor/hooks/` for a Sheavly run, so the dev guardrails have one
// implementation. A project hook may import only files inside `.sheavly/` and Node built-ins (the
// trust fingerprint covers nothing else), so it cannot share their modules; it runs them as
// processes the way Cursor does: JSON on stdin, JSON on stdout.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const TIMEOUT_MS = 60_000;
const MAX_REASON = 500;
/** What a script needs to run tools from node_modules and keep its state; the keys stay behind. */
const ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
  'CI',
  'SHEAVLY_HOOK_STATE_DIR',
];
/** The most output kept from a script, so a runaway one cannot fill the backend's memory. */
const MAX_OUTPUT = 1_000_000;

/** A Cursor hook script that could not run or answered something that is not JSON. */
export class CursorBridgeError extends Error {
  name = 'CursorBridgeError';

  constructor(params) {
    const { script, reason } = params;

    super(`The ${script} hook could not run: ${reason.slice(0, MAX_REASON)}`);
    this.script = script;
  }
}

/** The project root: two folders above `.sheavly/hooks/`. */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

/** A child's environment: only what it needs from this process, never an API key, plus `extra`. */
function childEnv(extra) {
  const kept = ENV_KEYS.filter((key) => process.env[key] !== undefined).map((key) => [
    key,
    process.env[key],
  ]);

  return { ...Object.fromEntries(kept), ...extra };
}

/** Kills the script and everything it started (prettier, eslint): they share its process group. */
function killGroup(child) {
  // A child that never started has no pid, and a group id of NaN would signal nothing useful.
  if (child.pid === undefined) return;

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (caughtError) {
    // Already gone (ESRCH) or not ours to signal (EPERM) is as stopped as it can be; the caller
    // rejects either way, so a failure to kill must not stop it from doing so.
    if (caughtError.code !== 'ESRCH' && caughtError.code !== 'EPERM') throw caughtError;
  }
}

/** The script's JSON answer, or a `CursorBridgeError` saying what it printed instead. */
function parseAnswer(params) {
  const { script, stdout } = params;

  let answer;

  try {
    answer = JSON.parse(stdout || '{}');
  } catch (caughtError) {
    // Only a parse failure means the script printed something else; anything else is a bug here.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    throw new CursorBridgeError({ script, reason: `it printed no JSON: ${stdout.slice(0, 200)}` });
  }

  // A hook answers with an object; `null`, a number or a list would break every reader past here.
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    throw new CursorBridgeError({
      script,
      reason: `it printed ${stdout.slice(0, 200)}, not an object`,
    });
  }

  return answer;
}

/**
 * Runs `script` (a file in `hooksDir`) with `input` on stdin, from `root`, and resolves with its
 * JSON answer. Rejects with `CursorBridgeError` when it does not start, exits non-zero, prints no
 * JSON, outlives `timeoutMs` or `signal` aborts (the whole process group is killed), so a guard
 * built on it can fail closed. It never blocks the backend's event loop. The child gets an
 * allow-listed environment plus `env` (tests point the hooks' state at a temp folder this way).
 */
export function runCursorHook(params) {
  const { script, input, root = PROJECT_ROOT, hooksDir, env = {}, signal } = params;
  const { timeoutMs = TIMEOUT_MS } = params;
  const dir = hooksDir ?? path.join(root, '.cursor', 'hooks');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, script)], {
      cwd: root,
      env: childEnv(env),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const onAbort = () => fail('aborted');
    const finish = (settle) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const fail = (reason) =>
      finish(() => {
        killGroup(child);
        reject(new CursorBridgeError({ script, reason }));
      });

    // `finish` reads `timer`, but only runs after this line: a timeout, an abort or a close event.
    const timer = setTimeout(() => fail(`timed out after ${timeoutMs} ms`), timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) fail(`it printed more than ${MAX_OUTPUT} characters`);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-MAX_REASON);
    });
    child.on('error', (error) => fail(error.message));
    // An already-aborted signal never fires its event, so it is checked once the handlers exist.
    if (signal?.aborted) onAbort();
    child.on('close', (code) =>
      finish(() => {
        if (code !== 0) {
          return reject(
            new CursorBridgeError({ script, reason: `exit ${code}: ${stderr.trim()}` }),
          );
        }

        try {
          resolve(parseAnswer({ script, stdout }));
        } catch (caughtError) {
          reject(caughtError);
        }
      }),
    );
    // A script that exits before reading its input closes the pipe; its exit code says what failed.
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}

/**
 * `result` with the text `advise()` resolves to appended (nothing for an empty answer). When the
 * script cannot run, the bridge's message is appended instead: advice is advisory, so the tool's
 * own result stands and the agent is told the check did not happen.
 */
export async function withAdvice(params) {
  const { result, advise } = params;

  try {
    const text = await advise();

    return text ? { ...result, content: `${result.content}\n\n${text}` } : result;
  } catch (caughtError) {
    if (!(caughtError instanceof CursorBridgeError)) throw caughtError;

    return { ...result, content: `${result.content}\n\n${caughtError.message}` };
  }
}

/**
 * An id for the hooks' per-chat state (hints shown once, the issue a chat named). A project hook
 * is not told which conversation it runs in, so it is one per backend process; the random part
 * keeps a reused process id from inheriting an earlier run's state.
 */
export const CHAT_ID = `sheavly-${process.pid}-${randomUUID()}`;
