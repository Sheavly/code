/**
 * The harness server: conversations served to UIs in other processes, over HTTP on this machine.
 *
 *   npm run serve -w @sheavly/terminal                 from source
 *
 * Each conversation is built like the chat's (the same tools, hooks and skills, on the same
 * settings: ADAPTER and its keys, MODEL, WORKSPACE_ROOT, RUN_COMMAND_SKIP_ALLOW_LIST, --trust).
 * It listens on SERVER_HOST:SERVER_PORT (127.0.0.1:4310 by default) and needs SERVER_TOKEN on
 * every request, as `Authorization: Bearer <token>`; without one it makes one and prints it once.
 * Ctrl+C, SIGTERM or closing the terminal stops it, and every conversation's prompts, tasks and
 * processes with it. Calls the real API, so it costs money. The routes: packages/server/docs.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { serve } from '@hono/node-server';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import { createServerApp } from '@sheavly/server/server/server.helper';
import { terminalConversation } from './harness/conversation.helper.js';
import { createTerminalHarness } from './harness/harness.helper.js';
import { providerFromEnv, trustStoreFromEnv } from './harness/settings.helper.js';
import { parseCliSettings, parseServerEnv } from './harness/settings.validator.js';
import { projectTrustNotice } from './render/render.utils.js';

// npm runs a workspace's script inside apps/terminal; work from the folder it was started in
// (npm's INIT_CWD), so `.env` and the default workspace are the user's, as with the chat.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
if (existsSync('.env')) process.loadEnvFile('.env');

const settings = parseCliSettings({ env: process.env, args: process.argv.slice(2) });
const server = parseServerEnv(process.env);
const { adapter, model, provider } = providerFromEnv(process.env);
const token = server.token ?? randomBytes(32).toString('base64url');

const conversations = new Conversations({
  create: async ({ messages }) => {
    const harness = await createTerminalHarness({
      provider,
      workspaceRoot: settings.workspaceRoot,
      skipAllowList: settings.skipAllowList,
      title: 'Served conversation',
      trustStore: trustStoreFromEnv(process.env),
      env: process.env,
      trustWorkspace: settings.trustWorkspace,
      home: homedir(),
    });
    const trustNotice = projectTrustNotice(harness.projectTrust);

    if (trustNotice) console.log(trustNotice);

    return terminalConversation({ harness, messages });
  },
});
const app = createServerApp({ conversations, token });

/** What the user needs once the server listens: where, the model, and the token when made here. */
function printStarted(): void {
  console.log(`→ ${adapter} / ${model}, serving on http://${server.host}:${String(server.port)}`);

  if (settings.skipAllowList) {
    console.log('⚠ run_command allow list is OFF: any shell command can run');
  }

  // Shown once, for the user to give their UI; never logged with a request.
  if (!server.token) console.log(`→ token (SERVER_TOKEN unset, so made for this run): ${token}`);

  console.log('→ Ctrl+C to stop');
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
