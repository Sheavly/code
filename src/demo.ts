/**
 * Quick manual check: one prompt, a real model, every tool, printed as it happens.
 *
 *   npm run demo -- "Read package.json and tell me the project name"
 *
 * Reads settings from the environment (or from .env if present).
 * ADAPTER picks the backend: "openai" (default) or "azure".
 * WORKSPACE_ROOT confines file tools to a directory (default: current directory).
 * RUN_COMMAND_SKIP_ALLOW_LIST=true lets run_command run any shell command (default: allow list on).
 * SHOW_MODEL_CALLS=true prints every model call (main session and sub-agents): its task, tools
 *   and system instructions.
 * SESSIONS_SSE_LOG=<file> writes the session registry's server-sent event stream to a file.
 * --trust trusts the workspace's .sheavly/ hooks (they run repo code); without it, an untrusted
 *   workspace runs none. SHEAVLY_TRUST_FILE moves the trust store (default ~/.config/sheavly/).
 * This calls the real API and costs money (a fraction of a cent for a short prompt).
 *
 * For stored prompts, saved runs and inspecting what happened, use the workbook instead
 * (`npm run workbook`, see workbook/README.md).
 */
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { streamAgent } from './loop/stream-agent/stream-agent.helper.js';
import { HOST_MAX_TURNS } from './host/host.constants.js';
import { createHarness, providerFromEnv, trustStoreFromEnv } from './host/host.service.js';
import { SAME_KEYPRESS_MS } from './terminal-ui/render.constants.js';
import { Renderer } from './terminal-ui/render.service.js';
import { projectTrustNotice, shortId } from './terminal-ui/render.utils.js';

const { adapter, model, provider } = providerFromEnv();
const args = process.argv.slice(2);
/** `--trust`: trust this workspace's `.sheavly/` hooks (remembered until `.sheavly/` changes). */
const trustWorkspace = args.includes('--trust');
const prompt =
  args.filter((arg) => arg !== '--trust').join(' ') ||
  'Read package.json and tell me the project name.';
const write = (text: string) => void process.stdout.write(text);
const workspaceRoot = z
  .string()
  .min(1)
  .optional()
  .parse(process.env.WORKSPACE_ROOT === '' ? undefined : process.env.WORKSPACE_ROOT);
/** Only the exact string "true" turns these on. */
const skipAllowList = process.env.RUN_COMMAND_SKIP_ALLOW_LIST === 'true';
const showModelCalls = process.env.SHOW_MODEL_CALLS === 'true';

const view: { renderer?: Renderer } = {};
const harness = await createHarness({
  provider,
  workspaceRoot,
  skipAllowList,
  title: prompt,
  trustStore: trustStoreFromEnv(),
  trustWorkspace,
  ...(showModelCalls && { onModelCall: (request) => view.renderer?.modelCall(request) }),
});
const { workspace, sessions, mainSession, tasks } = harness;

const renderer = new Renderer(write, tasks);

view.renderer = renderer;
sessions.subscribe((update) => renderer.session(update));

console.log(`→ ${adapter} / ${model} in ${workspace.root}`);
if (skipAllowList) console.log('⚠ run_command allow list is OFF: any shell command can run');

if (harness.projectHooks.length > 0) {
  console.log(`→ hooks from .sheavly: ${harness.projectHooks.map((hook) => hook.name).join(', ')}`);
}

const trustNotice = projectTrustNotice(harness.projectTrust);

if (trustNotice) console.log(trustNotice);

console.log(`→ ${prompt}\n`);
console.log(`→ main session ${shortId(mainSession.id)}`);

/** With SESSIONS_SSE_LOG, the registry's real SSE stream (what a UI would read) goes to a file. */
const sseLog = process.env.SESSIONS_SSE_LOG;
const stopSse = new AbortController();
const sseWritten = sseLog
  ? sessions
      .stream({ signal: stopSse.signal })
      .pipeTo(Writable.toWeb(createWriteStream(sseLog)) as WritableStream<Uint8Array>)
  : Promise.resolve();

// Ctrl+C once: stop the turn cleanly (tools killed, partial history kept). Twice: force quit.
// Commands run in their own process groups, so run_command kills them on exit either way.
const interrupt = new AbortController();
let interruptedAt = 0;

process.on('SIGINT', () => {
  if (interrupt.signal.aborted) {
    if (Date.now() - interruptedAt < SAME_KEYPRESS_MS) return;
    process.stdout.write('\n✗ Forced exit.\n');
    process.exit(130);
  }

  interruptedAt = Date.now();
  process.stdout.write('\n⏹ Interrupting… (Ctrl+C again to force quit)\n');
  interrupt.abort();
});

const events = streamAgent({
  provider: harness.provider,
  tools: harness.tools,
  hooks: harness.hooks,
  messages: [{ role: 'user', content: prompt }],
  maxTurns: HOST_MAX_TURNS,
  signal: interrupt.signal,
  tasks,
  session: { registry: sessions, ref: mainSession },
  // A one-shot demo: stay around to show background completions (Ctrl+C stops waiting).
  waitForTasks: true,
});

// Events arrive in causal order with contiguous `seq` numbers, so rendering is a plain loop.
/** Set when the run fails (a provider error, a hook throwing): shown once, then exit code 1. */
let failure: string | undefined;

try {
  for await (const event of events) renderer.event(event);
} catch (caughtError) {
  failure = caughtError instanceof Error ? caughtError.message : String(caughtError);
  process.stdout.write(`\n✗ Run failed: ${failure}\n`);
}

// Background tasks outlive a run, but not the demo: stop whatever is left before exiting.
if (tasks.runningCount > 0) {
  console.log(`⏹ Stopping ${tasks.runningCount} background task(s)`);
  await tasks.cancelAll();
}

stopSse.abort();
await sseWritten;

// Nothing else should be keeping the process alive; exit with the conventional code for Ctrl+C.
const interrupted = interrupt.signal.aborted ? 130 : 0;

process.exitCode = failure ? 1 : interrupted;
