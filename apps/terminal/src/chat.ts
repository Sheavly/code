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
 * WORKSPACE_ROOT, SHOW_MODEL_CALLS, --trust) and runs on the models
 * in the user's profile (~/.sheavly), and stops it on the way out; BACKEND_URL and BACKEND_TOKEN
 * use one already running.
 *
 * On a terminal it is a screen (apps/terminal/docs/chat.md): the conversation scrolls up into the
 * terminal's own history, and a command that needs your say asks you. Without one (piped input,
 * or `SHEAVLY_PLAIN=1`) it reads lines and refuses what would need asking. Ctrl+C stops the
 * running prompt, /<skill> anywhere in a message runs that skill, /exit ends the conversation.
 * Calls the real API, so it costs money.
 */
import { runLineChat } from './chat/line-chat.helper.js';
import { openSession } from './client/session.helper.js';
import { startScreenChat } from './tui/screen-chat.helper.js';

// npm runs a workspace's script inside apps/terminal; work from the folder it was started in
// (npm's INIT_CWD), so the default workspace is the user's.
if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);

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

/** A screen needs a terminal on both ends; piped input or output gets lines. */
const onTerminal = process.stdin.isTTY && process.stdout.isTTY && !process.env.SHEAVLY_PLAIN;

if (onTerminal) {
  const skills = (await conversation.skills()).map(({ name, description }) => ({
    name,
    description,
  }));
  const chat = await startScreenChat({ conversation, details, skills, firstPrompt });

  await chat.finished;
  await chat.stop();
} else {
  await runLineChat({
    conversation,
    details,
    renderer,
    write,
    firstPrompt,
    forceQuit: () => void end().finally(() => process.exit(130)),
  });
}

if (conversation.runningTasks > 0) {
  console.log(`⏹ Stopping ${String(conversation.runningTasks)} background task(s)`);
}

await end();
console.log('→ conversation ended');
