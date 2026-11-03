/**
 * The terminal chat: one conversation you keep talking to, prompt after prompt, with its history,
 * background tasks and the commands they started kept alive in between.
 *
 *   npm run dev -w @sheavly/terminal                       from source
 *   npm run start -w @sheavly/terminal                     built first, then plain Node
 *   npm run dev -w @sheavly/terminal -- "first message"    starts with that message
 *
 * (or `npm run dev` / `npm run start` inside apps/terminal).
 *
 * Settings are the demo's (apps/terminal/docs/demo.md): ADAPTER and its keys, MODEL,
 * WORKSPACE_ROOT, RUN_COMMAND_SKIP_ALLOW_LIST, SHOW_MODEL_CALLS, --trust. Ctrl+C stops the running
 * prompt, /<skill> anywhere in a message runs that skill, /exit or Ctrl+D ends the conversation. Calls the real API, so it costs money.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { skillRequest } from '@sheavly/workspace/skills/skill-files.helper';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import { CHAT_HELP } from './chat/chat.constants.js';
import { completeChatLine, listModels, parseChatInput, unknownCommand } from './chat/chat.utils.js';
import { MAX_TURNS } from './harness/harness.constants.js';
import { createCliHarness } from './harness/harness.helper.js';
import { SAME_KEYPRESS_MS } from './render/render.constants.js';
import { Renderer } from './render/render.service.js';
import { projectTrustNotice, skillsNotice } from './render/render.utils.js';

// npm runs a workspace's script inside apps/terminal; work from the folder it was started in
// (npm's INIT_CWD), so `.env` and the default workspace are the user's, as with the demo.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
if (existsSync('.env')) process.loadEnvFile('.env');

const write = (text: string) => void process.stdout.write(text);
const view: { renderer?: Renderer } = {};
const { harness, adapter, model, settings, models } = await createCliHarness({
  env: process.env,
  args: process.argv.slice(2),
  title: () => 'Terminal chat',
  onModelCall: (request) => view.renderer?.modelCall(request),
});
const { skipAllowList, prompt: firstPrompt } = settings;
const renderer = new Renderer(write, harness.tasks);

view.renderer = renderer;
harness.sessions.subscribe((update) => {
  // Every prompt goes idle and resumes; showing that each time is noise in a chat.
  if (update.type !== 'session_idle' && update.type !== 'session_resumed') renderer.session(update);
});

const conversation = createConversation({
  harness,
  run: streamAgent,
  tools: harness.tools,
  hooks: harness.hooks,
  maxTurns: MAX_TURNS,
});

// Closing the terminal (SIGHUP) or being killed (SIGTERM) skips Node's exit hooks, and background
// commands run in their own process groups: close the conversation first so none outlive the chat.
for (const [signal, code] of [
  ['SIGHUP', 129],
  ['SIGTERM', 143],
] as const) {
  process.once(signal, () => {
    void conversation.close().finally(() => process.exit(code));
  });
}

console.log(`→ ${adapter} / ${model} in ${harness.workspace.root}`);
if (models) console.log(`→ models: ${models.switch.names().join(', ')} (/model <name> to switch)`);
if (skipAllowList) console.log('⚠ run_command allow list is OFF: any shell command can run');

const trustNotice = projectTrustNotice(harness.projectTrust);

if (trustNotice) console.log(trustNotice);

const skillsReport = skillsNotice(await findSkills(harness.skills));

if (skillsReport) console.log(skillsReport);
console.log('→ /help for help, /exit or Ctrl+D to quit\n');

// Tab after `/` completes skill names (read fresh, so a new skill is offered at once) and commands.
const input = createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: async (before: string) =>
    completeChatLine({ before, skills: (await findSkills(harness.skills)).skills }),
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
  if (quitting || Date.now() - interruptedAt < SAME_KEYPRESS_MS) return;
  interruptedAt = Date.now();

  if (current && !current.signal.aborted) {
    write('\n⏹ Stopping this prompt… (Ctrl+C again to force quit)\n');
    current.abort();

    return;
  }

  quitting = true;

  if (current) {
    // A second, deliberate press while the prompt still stops force-quits, like the demo's.
    write('\n✗ Forced exit.\n');
    void conversation.close().finally(() => process.exit(130));

    return;
  }

  input.close();
});

/**
 * Runs one message to its end, printing its events; a failure is shown, and the chat goes on.
 * Skills it mentions (`/<name>` anywhere in it) run with it; one it starts with that no skill
 * has is an unknown command, reported instead of sent.
 */
async function send(text: string): Promise<void> {
  current = new AbortController();

  try {
    const request = await skillRequest({
      ...harness.skills,
      prompt: { text },
      signal: current.signal,
    });
    const unknown =
      request.skills.length === 0 ? unknownCommand({ text, unknown: request.unknown }) : undefined;

    if (unknown) {
      console.log(`Unknown command /${unknown}; /help lists them.`);

      return;
    }

    for await (const event of conversation.send(request.text, { signal: current.signal })) {
      renderer.event(event);
    }
  } catch (caughtError) {
    write(`\n✗ ${caughtError instanceof Error ? caughtError.message : String(caughtError)}\n`);
  } finally {
    current = undefined;
  }

  write('\n');
}

if (firstPrompt) await send(firstPrompt);

/** `/model` lists the models; `/model <name>` switches to one, from the next model call on. */
function modelCommand(name: string | undefined): string {
  if (!models) return `Only ${adapter} / ${model} is set up: list several in MODELS to switch.`;

  const { choices } = models;

  if (name === undefined) return listModels({ choices, active: models.switch.active });

  const choice = choices.find((candidate) => candidate.name === name);

  if (!choice) return `Unknown model ${name}; /model lists them.`;
  models.switch.use(name);

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
      console.log(modelCommand(parsed.name));
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

if (harness.tasks.runningCount > 0) {
  console.log(`⏹ Stopping ${String(harness.tasks.runningCount)} background task(s)`);
}

await conversation.close();
console.log('→ conversation ended');
