/**
 * The harness backend: conversations served to UIs in other processes, over HTTP on this machine.
 *
 *   npm run serve -w @sheavly/backend                  from source
 *
 * Each conversation runs on its workspace's profile: the models and keys in `~/.sheavly`
 * (`SHEAVLY_HOME` moves it), set up through the API, never `.env`. With none, a conversation is
 * refused with `not_set_up` and a UI onboards the user. Other settings: WORKSPACE_ROOT,
 * --trust, MAX_TURNS, WEB_FETCH, SUMMARY, CONTEXT_WINDOW, MODEL_CALLS_FILE,
 * SHOW_MODEL_CALLS, MODEL_RESPONSE_TIMEOUT_MS, MODEL_RETRIES, MODEL_RETRY_DELAY_MS. It listens on
 * SERVER_HOST:SERVER_PORT (127.0.0.1:4310 by default, moving to a free port when taken; port 0
 * picks a free one, from 20000-32000 when the OS has none; an explicit port that is taken fails)
 * and needs SERVER_TOKEN on every request but `GET /health` and `QUERY /handshake`, as
 * `Authorization: Bearer <token>`; without one it makes one and prints it once. Once it listens it
 * prints `→ listening on <url>`, the line a UI that started it waits for. A server that is not
 * SERVER_EXIT_WITH_PARENT and has not SERVER_DISCOVERY=false first takes its home's one-server
 * lock (exit 1 when another holds it) and publishes its address and token in the discovery file
 * once it listens; the others take no lock and write no file. Ctrl+C, SIGTERM, closing
 * the terminal or, with SERVER_EXIT_WITH_PARENT=true, its stdin closing (the UI that started it
 * is gone) stops it, and every conversation's prompts, tasks and processes with it. Calls the real
 * API, so it costs money. The routes: apps/backend/docs/api.md.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { sheavlyHome } from '@sheavly/storage/home/home.helper';
import { pruneScratch } from '@sheavly/workspace/scratch/scratch.helper';
import { createAdaptorServer } from '@hono/node-server';
import { createApiApp } from './api/api.helper.js';
import { createBackend } from './backend.helper.js';
import { claimServerPresence } from './discovery/claim-presence.helper.js';
import { STOP_SIGNALS } from './discovery/discovery.constants.js';
import { discoveryFileFor, isDiscoverable } from './discovery/discovery.utils.js';
import { guardStartup } from './discovery/startup-signals.helper.js';
import { SERVER } from './harness/harness.constants.js';
import { sharedScratchRoot } from './harness/scratch.helper.js';
import { parseCliSettings, parseRunEnv, parseServerEnv } from './harness/settings.validator.js';
import { newInstanceId } from './instance/instance-id.helper.js';
import { listenServer } from './listen/listen.helper.js';
import { portMovedNotice } from './listen/port-notice.utils.js';
import { configureServerTimeouts } from './listen/server-timeouts.helper.js';
import { readServerVersion } from './version/server-version.helper.js';

// npm runs a workspace's script inside its folder; work from the folder it was started in
// (npm's INIT_CWD), so the default workspace is the user's.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);

const settings = {
  ...parseCliSettings({ env: process.env, args: process.argv.slice(2) }),
  ...parseRunEnv(process.env),
};
const server = parseServerEnv(process.env);
const log = (text: string) => void process.stderr.write(text);

// Before the lock and the file exist: a signal while starting must not leave them behind.
const guard = guardStartup({ source: process, exit: (code) => process.exit(code), log });
const token = server.token ?? randomBytes(32).toString('base64url');
// Made once per start and returned by no route: it only salts the handshake proof.
const instanceId = newInstanceId();
const serverVersion = await readServerVersion();
// Everything that can fail on a setting or a build comes before the claim, so no error can leave
// the lock behind; the claim comes before anything that works or prints the token.
const { conversations, setup, workspaces, permissions } = createBackend({
  env: process.env,
  settings,
  log,
  remoteSetupAllowed: server.remoteSetupAllowed,
});
const app = createApiApp({
  conversations,
  setup,
  workspaces,
  permissions,
  token,
  instanceId,
  serverVersion,
  log,
});

/** What the user needs once the server listens: where their data is, and the token when made here. */
function printStarted(address: AddressInfo): void {
  console.log(`→ profiles and models in ${sheavlyHome(process.env)}`);

  // Shown once, for the user to give their UI; never logged with a request.
  if (!server.token) console.log(`→ token (SERVER_TOKEN unset, so made for this run): ${token}`);

  console.log('→ Ctrl+C to stop');

  const moved = portMovedNotice({
    portIsDefault: server.portIsDefault,
    defaultPort: SERVER.port,
    port: address.port,
  });

  if (moved) console.log(moved);

  // Last, as the line a UI that started this process waits for: everything is ready by then.
  console.log(`→ listening on http://${server.host}:${String(address.port)}`);
}

const listening = createAdaptorServer({ fetch: app.fetch, hostname: server.host });

// Two public routes read a body without a token: a client that trickles one is cut off.
configureServerTimeouts({ server: listening });

// The first thing the start takes: a refused start has changed nothing but its own lock probe.
const claiming = claimServerPresence({
  discoverable: isDiscoverable({ ...server, ...settings }),
  home: sheavlyHome(process.env),
  env: process.env,
  uid: process.getuid?.() ?? 0,
  log,
});

guard.track(claiming.then((claimed) => (claimed.status === 'go' ? claimed.presence : undefined)));

const start = await claiming;

// After a signal the guard cleans up and exits; the start does nothing more, not even refuse.
await guard.proceed();

if (start.status === 'refused') {
  log(`${start.message}\n`);
  process.exit(1);
}

const { presence } = start;

// Stale scratch entries are removed once at startup; a failure is reported, never fatal.
pruneScratch({ root: sharedScratchRoot() }).catch((caughtError: unknown) =>
  log(`Could not prune the scratch folder: ${String(caughtError)}\n`),
);

try {
  await listenServer({
    server: listening,
    host: server.host,
    port: server.port,
    fallback: server.portIsDefault,
  });
} catch (caughtError) {
  // The failure is the same error as without a lock, and no socket is left behind.
  await presence?.release();
  throw caughtError;
}

// A TCP listen (host and port) always has an address object, never a pipe path.
const address = listening.address() as AddressInfo;

await guard.proceed();

// Before the `listening` line, so a client that waited for it finds the file.
const publishing = presence?.publish(
  discoveryFileFor({
    ...server,
    port: address.port,
    token,
    instanceId,
    serverVersion,
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
  }),
);

// A signal now must wait for the write, or the file would appear after it was removed.
guard.track(Promise.resolve(publishing).then(() => presence));
await publishing;
await guard.proceed();

let stopping = false;

/** Stops taking requests, then closes every conversation: its prompts, tasks and processes. */
async function stop(code: number): Promise<never> {
  if (stopping) process.exit(code);
  stopping = true;
  // Out of the file first, so clients stop finding it; the lock last, so a successor cannot start
  // while conversations are still closing.
  await presence?.remove();
  listening.close();
  await conversations.closeAll();
  await presence?.release();
  console.log('→ stopped');
  process.exit(code);
}

for (const { signal, code } of STOP_SIGNALS) process.on(signal, () => void stop(code));

// After the stop handlers and before the `listening` line: with no listener for a moment, Node
// restores the default action, and a UI that signals on that line would kill the process.
guard.uninstall();
printStarted(address);

// A UI that started the backend holds its stdin open; when the UI exits, even killed, the pipe
// closes, so nothing it started outlives it.
if (settings.exitWithParent) {
  process.stdin.resume();
  process.stdin.once('end', () => void stop(0));
}
