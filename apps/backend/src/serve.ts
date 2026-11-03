/**
 * The harness backend: conversations served to UIs in other processes, over HTTP on this machine.
 *
 *   npm run serve -w @sheavly/backend                  from source
 *
 * Each conversation is built from this process's settings: ADAPTER and its keys (or MODELS),
 * MODEL, WORKSPACE_ROOT, RUN_COMMAND_SKIP_ALLOW_LIST, --trust, MAX_TURNS, WAIT_FOR_TASKS,
 * MODEL_CALLS_FILE, SHOW_MODEL_CALLS. It listens on SERVER_HOST:SERVER_PORT (127.0.0.1:4310 by
 * default; port 0 picks a free one) and needs SERVER_TOKEN on every request, as
 * `Authorization: Bearer <token>`; without one it makes one and prints it once. Once it listens it
 * prints `→ listening on <url>`, the line a UI that started it waits for. Ctrl+C, SIGTERM, closing
 * the terminal or, with SERVER_EXIT_WITH_PARENT=true, its stdin closing (the UI that started it
 * is gone) stops it, and every conversation's prompts, tasks and processes with it. Calls the real
 * API, so it costs money. The routes: packages/server/docs.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import { createServerApp } from '@sheavly/server/server/server.helper';
import { servedConversation } from './harness/served.helper.js';
import { providerFromEnv } from './harness/settings.helper.js';
import { parseCliSettings, parseRunEnv, parseServerEnv } from './harness/settings.validator.js';

// npm runs a workspace's script inside its folder; work from the folder it was started in
// (npm's INIT_CWD), so `.env` and the default workspace are the user's.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
if (existsSync('.env')) process.loadEnvFile('.env');

const settings = {
  ...parseCliSettings({ env: process.env, args: process.argv.slice(2) }),
  ...parseRunEnv(process.env),
};
const server = parseServerEnv(process.env);
// Read once up front, so a bad provider setting fails here rather than on the first conversation.
const { adapter, model } = providerFromEnv(process.env);
const token = server.token ?? randomBytes(32).toString('base64url');
const log = (text: string) => void process.stderr.write(text);

const conversations = new Conversations({
  create: ({ messages }) => servedConversation({ env: process.env, settings, messages, log }),
});
const app = createServerApp({ conversations, token });

/** What the user needs once the server listens: where, the model, and the token when made here. */
function printStarted(address: AddressInfo): void {
  console.log(`→ ${adapter} / ${model}`);

  if (settings.skipAllowList) {
    console.log('⚠ run_command allow list is OFF: any shell command can run');
  }

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
