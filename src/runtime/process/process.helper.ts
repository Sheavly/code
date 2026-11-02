import { spawn } from 'node:child_process';
import { ProcessInterruptedError, ProcessKillError } from '../errors/process.errors.js';
import { errorCode } from '../errors/errors.utils.js';
import { MAX_OUTPUT_CHARS } from './process.constants.js';
import type { ProcessParams, ProcessResult } from './process.types.js';

/** Env vars that look like secrets are not passed to commands. */
const SECRET_ENV = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

/**
 * Process groups still running. If the harness exits while commands are running (e.g. a
 * forced second Ctrl+C), they're killed rather than left orphaned.
 */
const liveGroups = new Set<number>();
let exitHookInstalled = false;

/** Kills a process group. Returns why it couldn't, unless the group had already exited. */
function killGroup(pid: number): ProcessKillError | undefined {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (caughtError) {
    // ESRCH: the group already exited, so there's nothing left to stop.
    if (errorCode(caughtError) === 'ESRCH') return undefined;

    return new ProcessKillError({ pid, cause: caughtError });
  }

  return undefined;
}

function trackGroup(pid: number): void {
  if (!exitHookInstalled) {
    process.once('exit', () => {
      // At exit there is no caller left to tell: an orphaned group fails the exit loudly.
      const failed = [...liveGroups].map(killGroup).find(Boolean);

      if (failed) throw failed;
    });
    exitHookInstalled = true;
  }

  liveGroups.add(pid);
}

/**
 * Runs a process in its own group with secrets scrubbed from its env. Aborting `signal`
 * (or hitting the timeout) kills the whole group, including anything it started.
 */
export function runProcess(params: ProcessParams): Promise<ProcessResult> {
  const { file, args, ...options } = params;

  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new ProcessInterruptedError());

      return;
    }

    const child = spawn(file, args, {
      cwd: options.cwd,
      shell: options.shell,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !SECRET_ENV.test(name)),
        ),
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so we can kill everything it started
    });

    if (child.pid) trackGroup(child.pid);

    let output = '';
    let timedOut = false;
    const append = (chunk: Buffer) => {
      const text = chunk.toString();

      if (output.length < MAX_OUTPUT_CHARS) output += text;
      options.onOutput?.(text);
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const kill = () => {
      const failed = child.pid ? killGroup(child.pid) : undefined;

      // The command may still be running: fail it now rather than wait for a close that may
      // never come. Its group stays tracked, so exit tries again.
      if (!failed) return;
      clearTimeout(timer);
      reject(failed);
    };
    let timer: NodeJS.Timeout | undefined;

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, options.timeoutMs);
    }

    options.signal.addEventListener('abort', kill, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', kill);
      if (child.pid) liveGroups.delete(child.pid);
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (exitCode) => {
      cleanup();
      resolve({ exitCode, output, timedOut });
    });
  });
}
