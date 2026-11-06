import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { BackendError } from '../errors/backend.errors.js';
import { BACKEND_PACKAGE, BACKEND_READY_MS, LISTENING_LINE } from './client.constants.js';
import type { Backend, BackendOptions } from './client.types.js';

/**
 * The backend the terminal talks to: `BACKEND_URL` and `BACKEND_TOKEN` connect to one already
 * running (another UI's); otherwise it starts its own with `env` (this run's settings), on a free
 * port with a token made here, and waits for it to say it listens. `stop` ends one it started, and
 * leaves one it only connected to alone.
 */
export async function connectBackend(options: BackendOptions): Promise<Backend> {
  const { env } = options;

  if (env.BACKEND_URL) {
    if (!env.BACKEND_TOKEN) {
      throw new BackendError({ message: 'Set BACKEND_TOKEN with BACKEND_URL' });
    }

    return { url: env.BACKEND_URL, token: env.BACKEND_TOKEN, stop: async () => undefined };
  }

  return startBackend(options);
}

/** Starts a backend and resolves once it listens; its output goes to `onOutput` as it comes. */
async function startBackend(options: BackendOptions): Promise<Backend> {
  const { env, args = [], onOutput } = options;
  const token = randomBytes(32).toString('base64url');
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: '0',
    SERVER_TOKEN: token,
    SERVER_EXIT_WITH_PARENT: 'true',
  };

  // tsx exports its config path to children. The backend must load its own workspace config.
  delete childEnv.TSX_TSCONFIG_PATH;

  // Through npm, by package name: the backend is a workspace npm knows, not a path into another
  // app. npm runs from this process's folder (the user's), so the backend's INIT_CWD is too.
  // Its own process group, so the Ctrl+C that stops a prompt here never reaches it; its stdin is
  // a pipe it holds open, so when this process exits, even killed, the backend stops too.
  const child = spawn('npm', npmArgs({ env, args }), {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const url = await waitForListening({ child, onOutput });

  return { url, token, stop: () => stopChild(child) };
}

/**
 * `npm run serve` of the backend's workspace, from the repo npm started this process in
 * (`npm_config_local_prefix`) so it is found from any folder, with `args` passed on.
 */
function npmArgs(params: { env: NodeJS.ProcessEnv; args: readonly string[] }): string[] {
  const { env, args } = params;
  const prefix = env.npm_config_local_prefix;

  return [
    'run',
    '--silent',
    ...(prefix ? ['--prefix', prefix] : []),
    '-w',
    BACKEND_PACKAGE,
    'serve',
    ...(args.length > 0 ? ['--', ...args] : []),
  ];
}

/** Resolves with the URL from the backend's `listening` line; rejects if it exits or is slow. */
function waitForListening(params: {
  child: ChildProcess;
  onOutput: (text: string) => void;
}): Promise<string> {
  const { child, onOutput } = params;

  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new BackendError({ message: `The backend didn't start in ${BACKEND_READY_MS} ms` }));
    }, BACKEND_READY_MS);
    const forward = (chunk: Buffer) => {
      const text = chunk.toString();

      onOutput(text);
      seen += text;

      const url = LISTENING_LINE.exec(seen)?.[1];

      if (!url) return;
      clearTimeout(timer);
      resolve(url);
    };

    child.stdout?.on('data', forward);
    child.stderr?.on('data', (chunk: Buffer) => onOutput(chunk.toString()));
    child.once('exit', (code) => {
      clearTimeout(timer);
      // After it listened, this rejects nothing: the promise is already settled.
      reject(
        new BackendError({ message: `The backend exited (${String(code)}) before it listened` }),
      );
    });
  });
}

/**
 * Asks a started backend to stop (it closes its conversations first) and waits for it to exit.
 * The signal goes to its whole process group: npm and the backend it runs.
 */
function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return Promise.resolve();

  const { pid } = child;

  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    process.kill(-pid, 'SIGTERM');
  });
}
