import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

const entry = (event: EntryEvent, sessionId = MAIN): StreamEntry => ({
  seq: 0,
  at: 0,
  sessionId,
  kind: 'event',
  event,
});
const activity = (active: boolean, sessionId = MAIN) =>
  entry({ seq: 0, type: 'reasoning_activity', active }, sessionId);

async function* stream(params: { entries: StreamEntry[]; failAfter: boolean }) {
  await Promise.resolve();
  yield* params.entries;
  if (params.failAfter) throw new Error('the backend went away');
}

function thinkingChat(params: { entries: StreamEntry[]; failAfter?: boolean }) {
  const told: boolean[] = [];
  const send = () => stream({ entries: params.entries, failAfter: params.failAfter ?? false });
  const unused = () => Promise.reject(new Error('not needed'));
  const conversation: ChatConversation = {
    send,
    followup: () => Promise.resolve(false),
    details: unused,
    useModel: unused,
    skills: () => Promise.resolve([]),
    runningTasks: 0,
  };
  const session = new ChatSession({
    conversation,
    renderer: new Renderer(
      () => undefined,
      () => 0,
    ),
    mainSession: MAIN,
    write: () => undefined,
    onThinking: (thinking) => told.push(thinking),
    onExit: () => undefined,
  });

  return { session, told };
}

describe('ChatSession: thinking', () => {
  it('tells the UI each change of the main session once', async () => {
    const { session, told } = thinkingChat({
      entries: [activity(true), activity(true), activity(false)],
    });

    session.submit('go');
    await session.idle();

    expect(told).toEqual([true, false]);
  });

  it('clears when the prompt fails while the model was thinking', async () => {
    const { session, told } = thinkingChat({ entries: [activity(true)], failAfter: true });

    session.submit('go');
    await session.idle();

    expect(told).toEqual([true, false]);
  });

  it('does not show a sub-agent as the main session thinking', async () => {
    const { session, told } = thinkingChat({
      entries: [activity(true, sessionIdSchema.parse('child'))],
    });

    session.submit('go');
    await session.idle();

    expect(told).toEqual([]);
  });
});
