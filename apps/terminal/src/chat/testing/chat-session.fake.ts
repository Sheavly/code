import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation } from '../chat.types.js';

export const MAIN_SESSION = sessionIdSchema.parse('main');

/**
 * A chat on a conversation that sends nothing: for entries the backend sends by itself, which
 * `ChatSession.hear` shows. `callbacks` are the UI's, as `ChatSession` takes them.
 */
export function listeningChat(params: {
  onBusy?: (busy: boolean) => void;
  /** A prompt's stream; none by default, as the backend starts the run itself. */
  send?: ChatConversation['send'];
  stop?: () => Promise<void>;
}) {
  const { onBusy, send, stop } = params;
  const unused = () => Promise.reject(new Error('not needed'));
  const conversation: ChatConversation = {
    send:
      send ??
      (() => {
        throw new Error('no prompt is sent: the backend starts this run itself');
      }),
    ...(stop && { stop }),
    yieldPrompt: () => Promise.resolve(false),
    details: unused,
    useModel: unused,
    skills: () => Promise.resolve([]),
    runningTasks: 0,
  };

  return new ChatSession({
    conversation,
    renderer: new Renderer(
      () => undefined,
      () => 0,
    ),
    mainSession: MAIN_SESSION,
    write: () => undefined,
    onExit: () => undefined,
    ...(onBusy && { onBusy }),
  });
}
