import { spawn } from 'node:child_process';
import { ProcessInterruptedError, ProcessKillError } from '../errors/process.errors.js';
import { errorCode } from '@sheavly/runtime/errors/errors.utils';
import { MAX_OUTPUT_CHARS, SECRET_ENV } from './process.constants.js';
import { OutputBuffer } from '@sheavly/runtime/output/output.service';
import { connectStreams } from './process-streams.helper.js';
import { runScript } from './script.helper.js';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { ProcessParams, ProcessResult, ScriptParams } from './process.types.js';

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

/**
 * Runs commands, each in its own process group, starting from the environment the host passed in
 * with secrets scrubbed, and keeps track of the groups still running. If the harness exits while some are (e.g. a forced second
 * Ctrl+C), they're killed rather than left orphaned. `createCodingHarness` makes one per harness; a
 * test makes its own, so its groups and exit hook never reach another test.
 */
export class ProcessRunner {
  /** What every command starts from, secrets removed. */
  readonly #baseEnv: Record<string, string>;

  constructor(params: { env: Environment }) {
    this.#baseEnv = Object.fromEntries(
      Object.entries(params.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && !SECRET_ENV.test(entry[0]),
      ),
    );
  }

  /** Process groups this runner started that are still running. */
  readonly #live = new Set<number>();
  readonly #onExit = () => {
    // At exit there is no caller left to tell: an orphaned group fails the exit loudly.
    const failed = [...this.#live].map(killGroup).find(Boolean);

    if (failed) throw failed;
  };

  /** Groups still running: empty once every command it started has exited. */
  get running(): number {
    return this.#live.size;
  }

  /** Tracks `pid` until it exits; the exit hook is installed only while something runs. */
  #track(pid: number): void {
    if (this.#live.size === 0) process.once('exit', this.#onExit);
    this.#live.add(pid);
  }

  #untrack(pid: number): void {
    if (!this.#live.delete(pid) || this.#live.size > 0) return;
    process.removeListener('exit', this.#onExit);
  }

  /**
   * Runs a line of commands joined by `|`, `&&`, `||` and `;` as a shell would, without one: each
   * command is its own process group, started from the same scrubbed environment as `run`. See
   * `runScript` for what a pipe, the timeout and a failure mean.
   */
  runScript(script: ScriptParams): Promise<ProcessResult> {
    return runScript({ run: (params) => this.run(params), script });
  }

  /**
   * Runs a process in its own group with secrets scrubbed from its env. Aborting `signal`
   * (or hitting the timeout) kills the whole group, including anything it started.
   */
  run(params: ProcessParams): Promise<ProcessResult> {
    const { file, args, input, stdoutTo, ...options } = params;

    return new Promise((resolve, reject) => {
      if (options.signal.aborted) {
        reject(new ProcessInterruptedError());

        return;
      }

      const child = spawn(file, args, {
        cwd: options.cwd,
        shell: options.shell,
        env: { ...this.#baseEnv, ...options.env },
        stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        detached: true, // own process group, so we can kill everything it started
      });

      if (child.pid) this.#track(child.pid);

      const output = new OutputBuffer({ maxChars: MAX_OUTPUT_CHARS });
      let timedOut = false;
      const append = (text: string) => {
        output.push(text);
        options.onOutput?.(text);
      };

      const kill = () => {
        const failed = child.pid ? killGroup(child.pid) : undefined;

        // The command may still be running: fail it now rather than wait for a close that may
        // never come. Its group stays tracked, so exit tries again.
        if (!failed) return;
        clearTimeout(timer);
        reject(failed);
      };

      const streams = connectStreams({
        child,
        input,
        stdoutTo,
        onChunk: append,
        onReaderGone: kill,
      });
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
        streams.disconnect();
        if (child.pid) this.#untrack(child.pid);
      };

      child.on('error', (error) => {
        cleanup();
        reject(error);
      });
      child.on('close', (exitCode) => {
        cleanup();
        resolve({ exitCode, output: output.text, timedOut });
      });
    });
  }
}
