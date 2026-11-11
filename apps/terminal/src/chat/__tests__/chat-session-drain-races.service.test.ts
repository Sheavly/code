import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../../render/render.service.js';
import { ChatSession } from '../chat-session.service.js';
import {
  settleStalledAcceptance,
  stalledConversation,
} from '../testing/stalled-conversation.fake.js';

const cleanups: (() => Promise<void>)[] = [];

function waitingSession() {
  const fake = stalledConversation();
  const written: string[] = [];
  const ended: string[] = [];
  const busy: boolean[] = [];
  const exit = vi.fn();
  const session = new ChatSession({
    conversation: fake.conversation,
    renderer: new Renderer(
      (text) => written.push(text),
      () => 0,
    ),
    mainSession: fake.main,
    write: (text) => written.push(text),
    onBusy: (value) => busy.push(value),
    onTurnEnd: (outcome) => ended.push(outcome),
    onExit: exit,
  });

  const chat = { ...fake, session, written, ended, busy, exit };

  cleanups.push(() => cleanupSession(chat));

  return chat;
}

async function startAcceptance(chat: ReturnType<typeof waitingSession>) {
  chat.session.submit('main');
  await vi.waitFor(() => expect(chat.written.join('')).toContain('Prompt open.'));
  chat.session.submit('ambiguous follow-up');
  await chat.acceptance.promise;
}

async function completeMain(chat: ReturnType<typeof waitingSession>) {
  chat.finish.resolve(undefined);
  await vi.waitFor(() => expect(chat.ended).toEqual(['completed']));
  expect(chat.session.busy).toBe(true);
  expect(chat.starts).toEqual(['main']);
}

async function stallDrainAfterCompletion(chat: ReturnType<typeof waitingSession>) {
  await startAcceptance(chat);
  await completeMain(chat);
}

async function expectIdle(chat: ReturnType<typeof waitingSession>) {
  await vi.waitFor(() => expect(chat.session.busy).toBe(false));
  await chat.session.idle();
  expect(chat.session.queued).toEqual([]);
}

async function expectCancelledDrain(chat: ReturnType<typeof waitingSession>) {
  await expectIdle(chat);
  expect(chat.signals[0]?.aborted).toBe(true);
}

async function settleLate(
  chat: ReturnType<typeof waitingSession>,
  settlement: 'accept' | 'reject',
  expectedStarts = ['main'],
) {
  await settleStalledAcceptance({ response: chat.response, settlement });
  expect(chat.starts).toEqual(expectedStarts);
  expect(chat.forwarded).toEqual(['ambiguous follow-up']);
  expect(chat.session.queued).toEqual([]);
  expect(chat.session.busy).toBe(false);
}

async function cleanupSession(chat: ReturnType<typeof waitingSession>) {
  chat.finish.resolve(undefined);
  chat.response.resolve(true);
  chat.session.dropQueued();
  await chat.session.idle();
}

afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  } finally {
    vi.useRealTimers();
  }
});

describe('ChatSession: drain idle transition', () => {
  it('drains input submitted after take returned undefined but before the idle transition', async () => {
    const fake = stalledConversation();
    const busyAtSubmission: boolean[] = [];
    const busy: boolean[] = [];
    let arm = false;
    let injected = false;
    const session = new ChatSession({
      conversation: fake.conversation,
      renderer: new Renderer(
        () => undefined,
        () => 0,
      ),
      mainSession: fake.main,
      write: () => undefined,
      onBusy: (value) => busy.push(value),
      onTurnEnd: () => {
        arm = true;
      },
      onQueue: (queue) => {
        if (!arm || injected || queue.length !== 0) return;
        injected = true;
        // take() snapshots the empty queue before its promise continuation can mark the drain idle.
        queueMicrotask(() => {
          busyAtSubmission.push(session.busy);
          session.submit('arrived in the drain gap');
        });
      },
      onExit: () => undefined,
    });

    fake.finish.resolve(undefined);
    session.submit('main');
    await session.idle();

    expect(injected).toBe(true);
    expect(busyAtSubmission).toEqual([true]);
    expect(fake.starts).toEqual(['main', 'arrived in the drain gap']);
    expect(session.queued).toEqual([]);
    expect(session.busy).toBe(false);
    expect(busy.at(-1)).toBe(false);
  });
});

describe('ChatSession: stalled acceptance cancellation', () => {
  it.each(['accept', 'reject'] as const)(
    'stop aborts active acceptance and ignores late %s without replay',
    async (settlement) => {
      const chat = waitingSession();

      await startAcceptance(chat);
      expect(chat.session.stop()).toBe('stopped');
      await expectCancelledDrain(chat);
      expect(chat.ended).toEqual(['completed']);
      await settleLate(chat, settlement);
    },
  );

  it.each(['accept', 'reject'] as const)(
    'stop releases acceptance after main completes even when there is no prompt left to abort, late %s',
    async (settlement) => {
      const chat = waitingSession();

      await stallDrainAfterCompletion(chat);
      expect(chat.session.stop()).toBe('idle');
      await expectCancelledDrain(chat);
      await settleLate(chat, settlement);
    },
  );

  it.each(['accept', 'reject'] as const)(
    'dropQueued releases a stalled post-completion drain and ignores late %s',
    async (settlement) => {
      const chat = waitingSession();

      await stallDrainAfterCompletion(chat);
      chat.session.dropQueued();
      await expectCancelledDrain(chat);
      await settleLate(chat, settlement);
    },
  );

  it.each(['accept', 'reject'] as const)(
    '/exit cancels acceptance immediately, waits for main, and ignores late %s',
    async (settlement) => {
      const chat = waitingSession();

      await startAcceptance(chat);
      chat.session.submit('/exit');
      await vi.waitFor(() => expect(chat.signals[0]?.aborted).toBe(true));
      expect(chat.exit).not.toHaveBeenCalled();
      expect(chat.promptSignals[0]?.aborted).toBe(false);
      expect(chat.ended).toEqual([]);
      chat.finish.resolve(undefined);
      await expectIdle(chat);
      expect(chat.exit).toHaveBeenCalledOnce();
      await settleLate(chat, settlement);
      chat.session.submit('ignored after exit');
      expect(chat.starts).toEqual(['main']);
    },
  );

  it.each(['accept', 'reject'] as const)(
    '/exit unblocks acceptance after main already completed and ignores late %s',
    async (settlement) => {
      const chat = waitingSession();

      await stallDrainAfterCompletion(chat);
      chat.session.submit('/exit');
      await expectCancelledDrain(chat);
      expect(chat.exit).toHaveBeenCalledOnce();
      await settleLate(chat, settlement);
    },
  );

  it('bounds a post-completion acceptance to five seconds and never retries ambiguous text', async () => {
    const chat = waitingSession();

    vi.useFakeTimers();
    chat.session.submit('main');
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.written.join('')).toContain('Prompt open.');
    chat.session.submit('ambiguous follow-up');
    await chat.acceptance.promise;
    chat.finish.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.ended).toEqual(['completed']);
    chat.session.submit('/help');
    chat.session.submit('next prompt');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(chat.session.busy).toBe(true);
    expect(chat.session.queued).toEqual(['ambiguous follow-up', '/help', 'next prompt']);
    await vi.advanceTimersByTimeAsync(1);
    await expectCancelledDrain(chat);
    expect(chat.written.join('')).toContain('not retried');
    expect(chat.starts).toEqual(['main', 'next prompt']);
    expect(chat.ended).toEqual(['completed', 'completed']);
    await settleLate(chat, 'accept', ['main', 'next prompt']);
  });
});
