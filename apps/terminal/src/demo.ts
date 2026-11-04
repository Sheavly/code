/**
 * Quick manual check: one prompt, a real model, every tool, printed as it happens.
 *
 *   npm run demo -- "Read package.json and tell me the project name"
 *
 * It starts its own backend with this environment's settings (or .env), and stops it after.
 * ADAPTER picks the backend: "openai" (default) or "azure".
 * WORKSPACE_ROOT confines file tools to a directory (default: current directory).
 * RUN_COMMAND_SKIP_ALLOW_LIST=true lets run_command run any shell command (default: allow list on).
 * SHOW_MODEL_CALLS=true prints every model call (main session and sub-agents): its task, tools
 *   and system instructions.
 * SESSIONS_SSE_LOG=<file> writes the conversation's stream, as a UI reads it, to a file.
 * --trust trusts the workspace's .sheavly/ hooks (they run repo code); without it, an untrusted
 *   workspace runs none. SHEAVLY_TRUST_FILE moves the trust store (default ~/.config/sheavly/).
 * The prompt waits for its background tasks before it ends (Ctrl+C stops waiting).
 * This calls the real API and costs money (a fraction of a cent for a short prompt).
 *
 * For stored prompts, saved runs and inspecting what happened, use the workbook instead
 * (`npm run workbook`, see apps/terminal/docs/workbook.md).
 */
import { createWriteStream, existsSync } from 'node:fs';
import { Writable } from 'node:stream';
import { now } from '@sheavly/core/clock/clock.helper';
import { openSession } from './client/session.helper.js';
import { SAME_KEYPRESS_MS } from './render/render.constants.js';
import { shortId } from './render/render.utils.js';

if (existsSync('.env')) process.loadEnvFile('.env');

/** What the demo asks with no prompt given. */
const DEFAULT_PROMPT = 'Read package.json and tell me the project name.';
const write = (text: string) => void process.stdout.write(text);
// A one-shot demo: its prompt waits for background tasks, to show them finish.
const session = await openSession({
  env: { ...process.env, WAIT_FOR_TASKS: 'true' },
  args: process.argv.slice(2),
  write,
});
const { backend, conversation, details, renderer } = session;
const prompt = session.prompt || DEFAULT_PROMPT;

console.log(`→ ${prompt}\n`);
console.log(`→ main session ${shortId(details.session)}`);

/** With SESSIONS_SSE_LOG, the conversation's SSE stream (what a UI reads) goes to a file. */
const sseLog = process.env.SESSIONS_SSE_LOG;
const stopSse = new AbortController();
const sseWritten = sseLog
  ? (await conversation.rawStream(stopSse.signal))
      .pipeTo(Writable.toWeb(createWriteStream(sseLog)) as WritableStream<Uint8Array>)
      // Stopping it below aborts the pipe: expected, the file has everything up to there.
      .catch((caughtError: unknown) => {
        if (!stopSse.signal.aborted) throw caughtError;
      })
  : Promise.resolve();

// Ctrl+C once: stop the prompt cleanly (tools killed, partial history kept). Twice: force quit.
const interrupt = new AbortController();
let interruptedAt = 0;

process.on('SIGINT', () => {
  if (interrupt.signal.aborted) {
    if (now() - interruptedAt < SAME_KEYPRESS_MS) return;
    process.stdout.write('\n✗ Forced exit.\n');
    void backend.stop().finally(() => process.exit(130));

    return;
  }

  interruptedAt = now();
  process.stdout.write('\n⏹ Interrupting… (Ctrl+C again to force quit)\n');
  interrupt.abort();
});

/** Set when the run fails (a provider error, a hook throwing): shown once, then exit code 1. */
let failure: string | undefined;

try {
  for await (const entry of conversation.send({ text: prompt, signal: interrupt.signal })) {
    renderer.entry(entry, details.session);
  }
} catch (caughtError) {
  failure = caughtError instanceof Error ? caughtError.message : String(caughtError);
  process.stdout.write(`\n✗ Run failed: ${failure}\n`);
}

// Background tasks outlive a prompt, but not the demo: closing stops whatever is left.
if (conversation.runningTasks > 0) {
  console.log(`⏹ Stopping ${String(conversation.runningTasks)} background task(s)`);
}

stopSse.abort();
await sseWritten;
await conversation.close();
await backend.stop();

// Nothing else should be keeping the process alive; exit with the conventional code for Ctrl+C.
const interrupted = interrupt.signal.aborted ? 130 : 0;

process.exitCode = failure ? 1 : interrupted;
