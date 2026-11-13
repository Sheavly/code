import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import { statusOfRun } from '../../tui/screen-chat.helper.js';
import type { ChatConversation, RunState } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');

let nextSeq = 0;

/** Entries are numbered upward, as the backend's stream is. */
const entry = (event: EntryEvent, sessionId = MAIN): StreamEntry => ({
  seq: nextSeq++,
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
  const runStates: RunState[] = [];
  const send = () => stream({ entries: params.entries, failAfter: params.failAfter ?? false });
  const unused = () => Promise.reject(new Error('not needed'));
  const conversation: ChatConversation = {
    send,
    yieldPrompt: () => Promise.resolve(false),
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
    onRunState: (run) => runStates.push(run),
    onExit: () => undefined,
  });

  return { session, told, runStates };
}

const runState = (state: 'working' | 'waiting', groupedTasks: number, sessionId = MAIN) =>
  entry({ seq: 0, type: 'run_state', state, groupedTasks }, sessionId);

describe('ChatSession: run state', () => {
  it('tells the UI each run_state of the main session, in order', async () => {
    const { session, runStates } = thinkingChat({
      entries: [runState('waiting', 2), runState('waiting', 0), runState('working', 0)],
    });

    session.submit('go');
    await session.idle();

    expect(runStates).toEqual([
      { state: 'waiting', groupedTasks: 2 },
      { state: 'waiting', groupedTasks: 0 },
      { state: 'working', groupedTasks: 0 },
    ]);
  });

  it('ignores a sub-agent’s run state', async () => {
    const { session, runStates } = thinkingChat({
      entries: [runState('waiting', 1, sessionIdSchema.parse('child'))],
    });

    session.submit('go');
    await session.idle();

    expect(runStates).toEqual([]);
  });

  it('shows working, awaiting grouped tasks, or ready when none are grouped', () => {
    expect(statusOfRun({ state: 'working', groupedTasks: 0 })).toEqual({ state: 'working' });
    expect(statusOfRun({ state: 'waiting', groupedTasks: 2 })).toEqual({
      state: 'awaiting_tasks',
      awaitedTasks: 2,
      thinking: false,
    });
    expect(statusOfRun({ state: 'waiting', groupedTasks: 0 })).toEqual({
      state: 'ready',
      thinking: false,
    });
  });
});

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
