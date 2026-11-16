import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation, TurnOutcome } from '../chat.types.js';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

export const MAIN_SESSION = sessionIdSchema.parse('main');

/** The main run's `done` entry, completed, at `seq` (later than the entries before it). */
export function doneEntry(seq = 1): StreamEntry {
  return {
    seq,
    at: 0,
    sessionId: MAIN_SESSION,
    kind: 'event',
    event: {
      seq,
      type: 'done',
      reason: 'completed',
      session: { id: MAIN_SESSION, rootId: MAIN_SESSION, depth: 1 },
    },
  };
}

/** A chat on `conversation` that prints nothing, telling the callbacks given. */
export function quietChat(params: {
  conversation: ChatConversation;
  onSend?: (text: string) => void;
  onTurnEnd?: (outcome: TurnOutcome) => void;
}) {
  const { conversation, onSend, onTurnEnd } = params;

  return new ChatSession({
    conversation,
    renderer: new Renderer(() => undefined),
    mainSession: MAIN_SESSION,
    write: () => undefined,
    onExit: () => undefined,
    ...(onSend && { onSend }),
    ...(onTurnEnd && { onTurnEnd }),
  });
}

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
  };

  return new ChatSession({
    conversation,
    renderer: new Renderer(() => undefined),
    mainSession: MAIN_SESSION,
    write: () => undefined,
    onExit: () => undefined,
    ...(onBusy && { onBusy }),
  });
}
