/**
 * The harness backend: conversations served to UIs in other processes, over HTTP on this machine.
 *
 *   npm run serve -w @sheavly/backend                  from source
 *
 * Each conversation runs on its workspace's profile: the models and keys in `~/.sheavly`
 * (`SHEAVLY_HOME` moves it), set up through the API, never `.env`. With none, a conversation is
 * refused with `not_set_up` and a UI onboards the user. Other settings: WORKSPACE_ROOT,
 * --trust, MAX_TURNS, WAIT_FOR_TASKS, WEB_FETCH, SUMMARY, CONTEXT_WINDOW, MODEL_CALLS_FILE,
 * SHOW_MODEL_CALLS, MODEL_RESPONSE_TIMEOUT_MS, MODEL_RETRIES, MODEL_RETRY_DELAY_MS. It listens on
 * SERVER_HOST:SERVER_PORT (127.0.0.1:4310 by
 * default; port 0 picks a free one) and needs SERVER_TOKEN on every request, as
 * `Authorization: Bearer <token>`; without one it makes one and prints it once. Once it listens it
 * prints `→ listening on <url>`, the line a UI that started it waits for. Ctrl+C, SIGTERM, closing
 * the terminal or, with SERVER_EXIT_WITH_PARENT=true, its stdin closing (the UI that started it
 * is gone) stops it, and every conversation's prompts, tasks and processes with it. Calls the real
 * API, so it costs money. The routes: apps/backend/docs/api.md.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { pruneScratch } from '@sheavly/workspace/scratch/scratch.helper';
import { serve } from '@hono/node-server';
import { createApiApp } from './api/api.helper.js';
import { createBackend } from './backend.helper.js';
import { sharedScratchRoot } from './harness/scratch.helper.js';
import { parseCliSettings, parseRunEnv, parseServerEnv } from './harness/settings.validator.js';
import { sheavlyHome } from './profiles/home.helper.js';

// npm runs a workspace's script inside its folder; work from the folder it was started in
// (npm's INIT_CWD), so the default workspace is the user's.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);

const settings = {
  ...parseCliSettings({ env: process.env, args: process.argv.slice(2) }),
  ...parseRunEnv(process.env),
};
const server = parseServerEnv(process.env);
const token = server.token ?? randomBytes(32).toString('base64url');
const log = (text: string) => void process.stderr.write(text);
const { conversations, setup, workspaces, permissions } = createBackend({
  env: process.env,
  settings,
  log,
  remoteSetupAllowed: server.remoteSetupAllowed,
});

// Stale scratch entries are removed once at startup; a failure is reported, never fatal.
pruneScratch({ root: sharedScratchRoot() }).catch((caughtError: unknown) =>
  log(`Could not prune the scratch folder: ${String(caughtError)}\n`),
);
const app = createApiApp({ conversations, setup, workspaces, permissions, token });

/** What the user needs once the server listens: where their data is, and the token when made here. */
function printStarted(address: AddressInfo): void {
  console.log(`→ profiles and models in ${sheavlyHome(process.env)}`);

  // Shown once, for the user to give their UI; never logged with a request.
  if (!server.token) console.log(`→ token (SERVER_TOKEN unset, so made for this run): ${token}`);

  console.log('→ Ctrl+C to stop');
  // Last, as the line a UI that started this process waits for: everything is ready by then.
  console.log(`→ listening on http://${server.host}:${String(address.port)}`);
}

const listening = serve(
  { fetch: app.fetch, hostname: server.host, port: server.port },
  printStarted,
);

let stopping = false;

/** Stops taking requests, then closes every conversation: its prompts, tasks and processes. */
async function stop(code: number): Promise<never> {
  if (stopping) process.exit(code);
  stopping = true;
  listening.close();
  await conversations.closeAll();
  console.log('→ stopped');
  process.exit(code);
}

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
] as const) {
  process.on(signal, () => void stop(code));
}

// A UI that started the backend holds its stdin open; when the UI exits, even killed, the pipe
// closes, so nothing it started outlives it.
if (settings.exitWithParent) {
  process.stdin.resume();
  process.stdin.once('end', () => void stop(0));
}
