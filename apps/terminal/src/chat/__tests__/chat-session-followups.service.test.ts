import { describe, expect, it } from 'vitest';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { RemoteConversation } from '../../client/conversation.service.js';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';

const ID = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const MAIN = sessionIdSchema.parse('main');
const SESSION = { id: MAIN, rootId: MAIN, depth: 1 as const };

function entry(event: EntryEvent): StreamEntry {
  return { seq: event.seq, at: 0, sessionId: MAIN, kind: 'event', event };
}

/** A real terminal HTTP client whose fake backend holds the active prompt open. */
async function waitingChat(params: { response?: Promise<boolean> } = {}) {
  const received = Promise.withResolvers<string>();
  const finish = Promise.withResolvers<undefined>();
  const starts: string[] = [];
  const followups: string[] = [];
  const ended: string[] = [];
  const written: string[] = [];
  const server = fakeServer({
    startConversation: () => ({ id: ID }),
    querySkills: () => ({ skills: [] }),
    async *sendPrompt() {
      yield entry({ seq: 0, type: 'turn_end', turn: 1, stopReason: 'end_turn' });
      const content = await Promise.race([received.promise, finish.promise]);

      if (content !== undefined) {
        yield entry({
          seq: 1,
          type: 'message_received',
          message: { from: 'user', content, sentAt: 1 },
        });
        yield entry({ seq: 2, type: 'text_delta', text: 'Handling the follow-up.' });
        await finish.promise;
      }

      yield entry({ seq: 3, type: 'done', reason: 'completed', session: SESSION });
    },
    sendFollowup: async ({ body }) => {
      const accepted = await (params.response ?? Promise.resolve(true));

      if (accepted) received.resolve((body as { text: string }).text);

      return { accepted };
    },
  });
  const conversation = await RemoteConversation.open({
    backend: {
      url: 'http://backend.test',
      token: 't',
      fetch: server.fetch,
      stop: async () => undefined,
    },
  });
  const session = new ChatSession({
    conversation,
    renderer: new Renderer(
      (text) => written.push(text),
      () => 1,
    ),
    mainSession: MAIN,
    write: (text) => written.push(text),
    onSend: (text) => starts.push(text),
    onFollowup: (text) => followups.push(text),
    onTurnEnd: (outcome) => ended.push(outcome),
    onExit: () => undefined,
  });

  return { session, server, finish, starts, followups, ended, written };
}

describe('ChatSession: follow-ups over HTTP', () => {
  it('sends a follow-up during the wait without opening another prompt or stopping work', async () => {
    const { session, server, finish, starts, followups, ended, written } = await waitingChat();

    try {
      session.submit('Review the changes.');
      await until(() => written.join('').includes('waiting for 1 background task'));
      session.submit('Also check deployment safety.');
      await until(() => written.join('').includes('Handling the follow-up.'));

      expect(followups).toEqual(['Also check deployment safety.']);
      expect(session.queued).toEqual([]);
      expect(session.busy).toBe(true);
      expect(ended).toEqual([]);
      expect(starts).toEqual(['Review the changes.']);
      expect(server.calls.filter(({ name }) => name === 'sendPrompt')).toHaveLength(1);
      expect(server.calls.some(({ name }) => name === 'stopPrompt')).toBe(false);
    } finally {
      finish.resolve(undefined);
      await session.idle();
    }

    expect(ended).toEqual(['completed']);
  });

  it('waits for a late refusal before sending the follow-up as the next prompt', async () => {
    const response = Promise.withResolvers<boolean>();
    const { session, server, finish, starts, ended, written } = await waitingChat({
      response: response.promise,
    });

    try {
      session.submit('Review the changes.');
      await until(() => written.join('').includes('waiting for 1 background task'));
      session.submit('Also check deployment safety.');
      await until(() => server.calls.some(({ name }) => name === 'sendFollowup'));
      finish.resolve(undefined);
      await until(() => ended.length === 1);

      expect(starts).toEqual(['Review the changes.']);
      expect(session.queued).toEqual(['Also check deployment safety.']);
      response.resolve(false);
      await session.idle();

      expect(starts).toEqual(['Review the changes.', 'Also check deployment safety.']);
      expect(server.calls.filter(({ name }) => name === 'sendPrompt')).toHaveLength(2);
      expect(server.calls.filter(({ name }) => name === 'sendFollowup')).toHaveLength(1);
    } finally {
      finish.resolve(undefined);
      response.resolve(false);
      await session.idle();
    }
  });

  it('forwards input entered before the first stream entry once the prompt is open', async () => {
    const { session, finish, followups, starts } = await waitingChat();

    try {
      session.submit('Review the changes.');
      session.submit('Also check deployment safety.');
      await until(() => followups.length === 1);

      expect(starts).toEqual(['Review the changes.']);
      expect(followups).toEqual(['Also check deployment safety.']);
    } finally {
      finish.resolve(undefined);
      await session.idle();
    }
  });
});
