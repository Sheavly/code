import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineChatDetails } from '../testing/line-chat.fake.js';
import type { RemoteConversation } from '../../client/conversation.service.js';
import { Renderer } from '../../render/render.service.js';
import { runLineChat } from '../line-chat.helper.js';
import {
  settleStalledAcceptance,
  stalledConversation,
} from '../testing/stalled-conversation.fake.js';

const mocks = vi.hoisted(() => ({ readline: vi.fn() }));

// Only replace the process-wide stream factory; the interface, iterator and ChatSession are real.
vi.mock('node:readline/promises', () => ({ createInterface: mocks.readline }));

const cleanups: (() => Promise<void>)[] = [];

function lineChat() {
  const fake = stalledConversation();
  const source = new PassThrough();
  const output = new PassThrough();
  const input = createInterface({ input: source, output });
  const closed = Promise.withResolvers<undefined>();
  const written: string[] = [];
  const forceQuit = vi.fn();
  let finished = false;

  input.once('close', () => closed.resolve(undefined));
  mocks.readline.mockReturnValue(input);

  const running = runLineChat({
    conversation: fake.conversation as RemoteConversation,
    details: lineChatDetails,
    renderer: new Renderer(
      (text) => written.push(text),
      () => 0,
    ),
    write: (text) => written.push(text),
    firstPrompt: 'main',
    forceQuit,
  }).then(() => {
    finished = true;
  });

  cleanups.push(async () => {
    fake.finish.resolve(undefined);
    fake.response.resolve(true);
    source.end();
    input.close();
    await running;
    source.destroy();
    output.destroy();
  });

  return { ...fake, source, input, closed, written, running, forceQuit, finished: () => finished };
}

async function startAcceptance(chat: ReturnType<typeof lineChat>) {
  await vi.waitFor(() => expect(chat.written.join('')).toContain('Prompt open.'));
  chat.source.write('ambiguous follow-up\n');
  await chat.acceptance.promise;
  expect(chat.forwarded).toEqual(['ambiguous follow-up']);
}

async function waitForLineChatCompletion(chat: ReturnType<typeof lineChat>) {
  await vi.waitFor(() => expect(chat.finished()).toBe(true));
  await chat.running;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.clearAllMocks();
});

describe('runLineChat: real session and readline EOF', () => {
  it.each(['accept', 'reject'] as const)(
    'EOF cancels stalled acceptance without stopping main, ignores late %s, and drains queued input',
    async (settlement) => {
      const chat = lineChat();

      await startAcceptance(chat);
      chat.source.end('/help\nqueued after EOF\n');
      await chat.closed.promise;
      await vi.waitFor(() => expect(chat.signals[0]?.aborted).toBe(true));
      expect(chat.finished()).toBe(false);
      expect(chat.promptSignals[0]?.aborted).toBe(false);
      expect(chat.starts).toEqual(['main']);

      chat.finish.resolve(undefined);
      await waitForLineChatCompletion(chat);
      expect(chat.starts).toEqual(['main', 'queued after EOF']);
      expect(chat.forwarded).toEqual(['ambiguous follow-up']);
      expect(chat.written.join('')).toContain('/help');
      expect(chat.forceQuit).not.toHaveBeenCalled();

      await settleStalledAcceptance({ response: chat.response, settlement });
      expect(chat.starts).toEqual(['main', 'queued after EOF']);
      expect(chat.forwarded).toEqual(['ambiguous follow-up']);
    },
  );

  it.each(['accept', 'reject'] as const)(
    'EOF releases a drain stalled after main completes, before late %s',
    async (settlement) => {
      const chat = lineChat();

      await startAcceptance(chat);
      chat.finish.resolve(undefined);
      await vi.waitFor(() => expect(chat.ends).toEqual(['main']));
      expect(chat.finished()).toBe(false);
      chat.source.end();
      await chat.closed.promise;
      await waitForLineChatCompletion(chat);
      expect(chat.signals[0]?.aborted).toBe(true);
      expect(chat.starts).toEqual(['main']);

      await settleStalledAcceptance({ response: chat.response, settlement });
      expect(chat.starts).toEqual(['main']);
      expect(chat.forwarded).toEqual(['ambiguous follow-up']);
      expect(chat.forceQuit).not.toHaveBeenCalled();
    },
  );

  it('runs buffered lines after EOF without forwarding them into subsequent prompts', async () => {
    const chat = lineChat();

    await vi.waitFor(() => expect(chat.written.join('')).toContain('Prompt open.'));
    // A command is a forwarding barrier, so all three lines are queued before EOF closes input.
    chat.source.end('/help\nsecond\nthird\n');
    await chat.closed.promise;
    expect(chat.finished()).toBe(false);
    chat.finish.resolve(undefined);
    await waitForLineChatCompletion(chat);

    expect(chat.starts).toEqual(['main', 'second', 'third']);
    expect(chat.forwarded).toEqual([]);
    expect(chat.forceQuit).not.toHaveBeenCalled();
  });
});
