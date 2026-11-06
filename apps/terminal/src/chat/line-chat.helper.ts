import { createInterface } from 'node:readline/promises';
import { stripVTControlCharacters } from 'node:util';
import { now } from '@sheavly/core/clock/clock.helper';
import type { ConversationDetails } from '@sheavly/protocol/server/server.types';
import { ChatSession } from './chat-session.service.js';
import { completeChatLine } from './chat.utils.js';
import type { RemoteConversation } from '../client/conversation.service.js';
import { SAME_KEYPRESS_MS } from '../render/render.constants.js';
import type { Renderer } from '../render/render.service.js';

/**
 * Runs the chat as lines in and lines out, for input that is not a terminal (piped, scripted) and
 * for a terminal that cannot run the screen. Approvals are not answered here: a command that
 * needs one is refused and the model told, as there is no one to ask.
 *
 * Returns when the user left: `/exit`, Ctrl+D, the end of piped input once its lines have run,
 * or Ctrl+C at the input line. `stopTasks` is called with the number of background tasks still
 * running at that point.
 */
export async function runLineChat(params: {
  conversation: RemoteConversation;
  details: ConversationDetails;
  renderer: Renderer;
  write: (text: string) => void;
  firstPrompt: string | undefined;
  /** Called when a second, deliberate Ctrl+C asks to leave while a prompt still runs. */
  forceQuit: () => void;
}): Promise<void> {
  const { conversation, details, renderer, write, firstPrompt, forceQuit } = params;

  if (details.models.length > 0) {
    write(
      `→ models: ${details.models.map(({ name }) => name).join(', ')} (/model <name> to switch)\n`,
    );
  }

  write('→ /help for help, /exit or Ctrl+D to quit\n\n');

  // Tab after `/` completes skill names (read fresh, so a new skill is offered at once) and commands.
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: async (before: string) =>
      completeChatLine({ before, skills: await conversation.skills() }),
  });
  // Read lines from the start, so lines typed (or piped in) while the first prompt runs are kept;
  // readline only listens once its iterator exists.
  const lines = input[Symbol.asyncIterator]();
  let inputOpen = true;
  let quitting = false;
  let interruptedAt = 0;

  input.once('close', () => (inputOpen = false));

  const session: ChatSession = new ChatSession({
    conversation,
    renderer,
    mainSession: details.session,
    // Line mode is plain text: what `/changes` prints is styled for the screen, so drop that.
    write: (text) => write(stripVTControlCharacters(text)),
    onExit: () => (quitting = true),
  });

  // Ctrl+C stops the running prompt; pressed again while it stops, it force-quits (stopping what the
  // conversation started first), and at the input line it quits.
  input.on('SIGINT', () => {
    // The same key press seen twice (as under `npx tsx`) acts once, whatever it did.
    if (quitting || now() - interruptedAt < SAME_KEYPRESS_MS) return;
    interruptedAt = now();

    const stopped = session.stop();

    if (stopped === 'stopped') {
      write('\n⏹ Stopping this prompt… (Ctrl+C again to force quit)\n');

      return;
    }

    quitting = true;

    if (stopped === 'stopping') {
      write('\n✗ Forced exit.\n');
      forceQuit();

      return;
    }

    input.close();
  });

  if (firstPrompt) session.submit(firstPrompt);
  await session.idle();

  input.setPrompt('› ');
  if (inputOpen) input.prompt();

  for (let next = await lines.next(); !next.done && !quitting; next = await lines.next()) {
    session.submit(next.value);
    await session.idle();
    if (quitting) break;
    if (inputOpen) input.prompt();
  }

  input.close();
}
