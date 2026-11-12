import { describe, expect, it } from 'vitest';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { maskOldToolOutput } from '../mask.utils.js';

const call = (id: string): Message => ({
  role: 'assistant',
  content: '',
  toolCalls: [{ id: callIdSchema.parse(id), name: 'read_file', input: {} }],
});
const result = (id: string, content: string, isError = false): Message => ({
  role: 'tool',
  toolCallId: callIdSchema.parse(id),
  content,
  isError,
});
/** `count` call/result pairs, each result `size` characters long. */
const pairs = (count: number, size: number): Message[] =>
  Array.from({ length: count }, (_, index) => [
    call(`c${String(index)}`),
    result(`c${String(index)}`, `result ${String(index)} ${'x'.repeat(size)}`),
  ]).flat();
const prompt: Message = { role: 'user', content: 'go' };
const contentOf = (message: Message | undefined) =>
  message?.role === 'tool' ? message.content : '';

describe('maskOldToolOutput', () => {
  it('hides nothing below the start share of the window, or with no known window', () => {
    const view = [prompt, ...pairs(30, 2_000)];

    expect(maskOldToolOutput({ view, window: 10_000_000 })).toBe(view);
    expect(maskOldToolOutput({ view, window: undefined })).toBe(view);
  });

  it('hides the oldest results in whole steps and keeps the newest ten whole', () => {
    const view = [prompt, ...pairs(30, 2_000)];
    const masked = maskOldToolOutput({ view, window: 30_000 });
    const tools = masked.filter((message) => message.role === 'tool');

    // 30 results: the newest 10 stay; of the other 20, a whole number of steps of 8 is hidden.
    expect(tools.filter((message) => contentOf(message).startsWith('[An earlier')).length).toBe(16);
    expect(contentOf(tools[16])).toContain('result 16');
    expect(contentOf(tools[29])).toContain('result 29');
  });

  it('keeps every call paired with its result, in order, and the error flag', () => {
    const view = [prompt, ...pairs(30, 2_000), result('x', 'failed '.repeat(200), true)];
    const masked = maskOldToolOutput({ view, window: 30_000 });

    expect(masked).toHaveLength(view.length);
    expect(masked.map((message) => message.role)).toEqual(view.map((message) => message.role));
    expect(
      masked.filter((message) => message.role === 'tool').every((tool) => 'isError' in tool),
    ).toBe(true);
  });

  it('says how big a hidden result was and that the tool can be called again', () => {
    const masked = maskOldToolOutput({ view: [prompt, ...pairs(30, 2_000)], window: 30_000 });

    expect(contentOf(masked[2])).toMatch(/^\[An earlier tool result of \d+ characters was hidden/);
    expect(contentOf(masked[2])).toContain('call the tool again');
  });

  it('keeps the line that says where the complete output is stored', () => {
    const stored = result(
      'c0',
      `${'y'.repeat(2_000)}\nFull output: output_ref=abc123 (9000 bytes stored, complete)\nmore`,
    );
    const view = [prompt, call('c0'), stored, ...pairs(30, 2_000).slice(0)];
    const masked = maskOldToolOutput({ view, window: 30_000 });

    expect(contentOf(masked[2])).toContain('Full output: output_ref=abc123');
    expect(contentOf(masked[2])).not.toContain('yyyy');
  });

  it('leaves a short result alone, since the note would be as long', () => {
    const view = [prompt, call('s'), result('s', 'ok'), ...pairs(30, 2_000)];
    const masked = maskOldToolOutput({ view, window: 30_000 });

    expect(contentOf(masked[2])).toBe('ok');
  });

  it('only ever hides more as results are added, so a call is never un-hidden', () => {
    const view = [prompt, ...pairs(40, 2_000)];
    const earlier = maskOldToolOutput({ view: view.slice(0, 1 + 2 * 30), window: 30_000 });
    const later = maskOldToolOutput({ view, window: 30_000 });
    const hiddenIn = (messages: readonly Message[]) =>
      messages.flatMap((message, index) =>
        contentOf(message).startsWith('[An earlier') ? [index] : [],
      );

    for (const index of hiddenIn(earlier)) expect(hiddenIn(later)).toContain(index);
  });
});
