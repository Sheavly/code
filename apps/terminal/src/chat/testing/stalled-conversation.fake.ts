import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { ChatConversation } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

/** Settle a response that deliberately outlives abort, then flush its abandoned handlers. */
export async function settleStalledAcceptance(params: {
  response: ReturnType<typeof Promise.withResolvers<boolean>>;
  settlement: 'accept' | 'reject';
}) {
  const { response, settlement } = params;
  const failure = new Error('Late acceptance transport failure');

  if (settlement === 'accept') {
    response.resolve(true);
  } else {
    response.reject(failure);
  }

  await response.promise.catch((caughtError: unknown) => {
    if (caughtError !== failure) throw caughtError;
  });
  // No wall-clock sleeps or new submissions: settlement must not restart the abandoned drain.
  await Promise.resolve();
  await Promise.resolve();
}

function entry(event: EntryEvent): StreamEntry {
  return { seq: event.seq, at: 0, sessionId: MAIN, kind: 'event', event };
}

/** The acceptance response deliberately ignores abort, so late backend settlement remains testable. */
export function stalledConversation() {
  const finish = Promise.withResolvers<undefined>();
  const response = Promise.withResolvers<boolean>();
  const acceptance = Promise.withResolvers<AbortSignal | undefined>();
  const starts: string[] = [];
  const ends: string[] = [];
  const forwarded: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const promptSignals: (AbortSignal | undefined)[] = [];
  const conversation: ChatConversation = {
    runningTasks: 0,
    skills: async () => [],
    details: async () => {
      throw new Error('These regressions do not query models.');
    },
    useModel: async () => false,
    followup: (text: string, signal?: AbortSignal) => {
      forwarded.push(text);
      signals.push(signal);
      acceptance.resolve(signal);

      return response.promise;
    },
    async *send({ text, signal }) {
      starts.push(text);
      promptSignals.push(signal);
      yield entry({ seq: 0, type: 'text_delta', text: 'Prompt open.' });

      if (starts.length === 1) {
        signal?.addEventListener('abort', () => finish.resolve(undefined), { once: true });
        await finish.promise;
      }

      yield entry({
        seq: 1,
        type: 'done',
        reason: 'completed',
        session: { id: MAIN, rootId: MAIN, depth: 1 },
      });
      ends.push(text);
    },
  };

  return {
    conversation,
    finish,
    response,
    acceptance,
    starts,
    ends,
    forwarded,
    signals,
    promptSignals,
    main: MAIN,
  };
}
