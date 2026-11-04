/**
 * The terminal chat: one conversation you keep talking to, prompt after prompt, with its history,
 * background tasks and the commands they started kept alive in between, on the backend.
 *
 *   npm run dev -w @sheavly/terminal                       from source
 *   npm run start -w @sheavly/terminal                     built first, then plain Node
 *   npm run dev -w @sheavly/terminal -- "first message"    starts with that message
 *
 * (or `npm run dev` / `npm run start` inside apps/terminal).
 *
 * It starts its own backend with this environment's settings (apps/backend/docs/serve.md:
 * ADAPTER and its keys, MODEL, WORKSPACE_ROOT, RUN_COMMAND_SKIP_ALLOW_LIST, SHOW_MODEL_CALLS,
 * --trust), and stops it on the way out; BACKEND_URL and BACKEND_TOKEN use one already running.
 * Ctrl+C stops the running prompt, /<skill> anywhere in a message runs that skill, /exit or
 * Ctrl+D ends the conversation. Calls the real API, so it costs money.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { now } from '@sheavly/core/clock/clock.helper';
import { findSkillMentions } from '@sheavly/workspace/skills/skills.utils';
import { CHAT_HELP } from './chat/chat.constants.js';
import {
  completeChatLine,
  listModels,
  parseChatInput,
  pickModel,
  unknownCommand,
} from './chat/chat.utils.js';
import { openSession } from './client/session.helper.js';
import { SAME_KEYPRESS_MS } from './render/render.constants.js';

// npm runs a workspace's script inside apps/terminal; work from the folder it was started in
// (npm's INIT_CWD), so `.env` and the default workspace are the user's.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
if (existsSync('.env')) process.loadEnvFile('.env');

const write = (text: string) => void process.stdout.write(text);
const session = await openSession({ env: process.env, args: process.argv.slice(2), write });
const { backend, conversation, details, renderer, prompt: firstPrompt } = session;

/** Closes the conversation, then the backend if this chat started it. */
async function end(): Promise<void> {
  await conversation.close();
  await backend.stop();
}

// Closing the terminal (SIGHUP) or being killed (SIGTERM) skips Node's exit hooks: close the
// conversation and the backend first, so none of its background commands outlive the chat.
for (const [signal, code] of [
  ['SIGHUP', 129],
  ['SIGTERM', 143],
] as const) {
  process.once(signal, () => {
    void end().finally(() => process.exit(code));
  });
}

if (details.models.length > 0) {
  console.log(
    `→ models: ${details.models.map(({ name }) => name).join(', ')} (/model <name> to switch)`,
  );
}

console.log('→ /help for help, /exit or Ctrl+D to quit\n');

// Tab after `/` completes skill names (read fresh, so a new skill is offered at once) and commands.
const input = createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: async (before: string) =>
    completeChatLine({ before, skills: await conversation.skills() }),
});
// Read lines from the start, so lines typed (or piped in) while the first prompt runs are kept;
// readline only listens once its iterator exists. They are sent in order, after the prompt.
const lines = input[Symbol.asyncIterator]();
// Input can close while a prompt runs (Ctrl+D, or piped input ending): the lines already read
// still run, without asking for more.
let inputOpen = true;

input.once('close', () => (inputOpen = false));
/** The running prompt's stop switch, if one runs. */
let current: AbortController | undefined;
let interruptedAt = 0;

/** Set once the user asked to leave: lines typed but not yet sent are dropped, not sent. */
let quitting = false;

// Ctrl+C stops the running prompt; pressed again while it stops, it force-quits (stopping what the
// conversation started first), and at the input line it quits.
input.on('SIGINT', () => {
  // The same key press seen twice (as under `npx tsx`) acts once, whatever it did: the echo never
  // stops another prompt, quits twice, or quits after a stop. Once quitting, every press is done.
  if (quitting || now() - interruptedAt < SAME_KEYPRESS_MS) return;
  interruptedAt = now();

  if (current && !current.signal.aborted) {
    write('\n⏹ Stopping this prompt… (Ctrl+C again to force quit)\n');
    current.abort();

    return;
  }

  quitting = true;

  if (current) {
    // A second, deliberate press while the prompt still stops force-quits, like the demo's.
    write('\n✗ Forced exit.\n');
    void end().finally(() => process.exit(130));

    return;
  }

  input.close();
});

/**
 * Runs one message to its end, printing its entries; a failure is shown, and the chat goes on.
 * Skills it mentions (`/<name>` anywhere in it) run with it; one it starts with that no skill
 * has is an unknown command, reported instead of sent.
 */
async function send(text: string): Promise<void> {
  current = new AbortController();

  try {
    const known = new Set((await conversation.skills()).map(({ name }) => name));
    const unknown = unknownCommand({
      text,
      unknown: findSkillMentions(text)
        .map(({ name }) => name)
        .filter((name) => !known.has(name)),
    });

    if (unknown) {
      console.log(`Unknown command /${unknown}; /help lists them.`);

      return;
    }

    for await (const entry of conversation.send({ text, signal: current.signal })) {
      renderer.entry(entry, details.session);
    }
  } catch (caughtError) {
    write(`\n✗ ${caughtError instanceof Error ? caughtError.message : String(caughtError)}\n`);
  } finally {
    current = undefined;
  }

  write('\n');
}

if (firstPrompt) await send(firstPrompt);

/**
 * `/model` lists the models; `/model <id or name>` switches to one, from the next model call on.
 * What is typed only finds the model (`pickModel`): the switch is made by its id.
 */
async function modelCommand(typed: string | undefined): Promise<string> {
  const { model, models } = await conversation.details();

  if (models.length === 0) {
    return `Only ${model.adapter} / ${model.model} is set up: list several in MODELS to switch.`;
  }

  if (typed === undefined) return listModels({ choices: models, active: model.id });

  const picked = pickModel({ choices: models, typed });

  if (picked.kind === 'none') return `Unknown model ${typed}; /model lists them.`;

  if (picked.kind === 'ambiguous') {
    const same = listModels({ choices: picked.choices, active: model.id });

    return `${String(picked.choices.length)} models are called ${typed}; use an id:\n${same}`;
  }

  const { choice } = picked;

  if (!(await conversation.useModel(choice.id))) {
    return `Unknown model ${typed}; /model lists them.`;
  }

  return `→ ${choice.name}: ${choice.adapter} / ${choice.model}`;
}

/** Handles one line; false once the user asked to leave. */
async function handle(line: string): Promise<boolean> {
  const parsed = parseChatInput(line);

  switch (parsed.kind) {
    case 'exit':
      return false;
    case 'help':
      console.log(CHAT_HELP);
      break;
    case 'model':
      console.log(await modelCommand(parsed.name));
      break;
    case 'prompt':
      await send(parsed.text);
      break;
    case 'empty':
      break;
  }

  return true;
}

// The loop ends on /exit, Ctrl+D, the end of piped input, or Ctrl+C at the input line.
input.setPrompt('› ');
if (inputOpen) input.prompt();

for (let next = await lines.next(); !next.done && !quitting; next = await lines.next()) {
  if (!(await handle(next.value)) || quitting) break;
  if (inputOpen) input.prompt();
}

input.close();

if (conversation.runningTasks > 0) {
  console.log(`⏹ Stopping ${String(conversation.runningTasks)} background task(s)`);
}

await end();
console.log('→ conversation ended');
