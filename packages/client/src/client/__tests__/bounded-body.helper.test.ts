import { describe, expect, it } from 'vitest';
import { AnswerTooLargeError } from '../../errors/client.errors.js';
import { readBoundedText } from '../bounded-body.helper.js';

const CAP = 100;
const read = (response: Response) =>
  readBoundedText({ response, route: 'getHealth', maxBytes: CAP });

/** A response whose body yields `chunks` bytes at a time, and records whether it was cancelled. */
function endlessBody(chunkBytes: number) {
  const state = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
    },
    cancel() {
      state.cancelled = true;
    },
  });

  return { state, response: new Response(body) };
}

describe('readBoundedText', () => {
  it('reads a body within the cap, whole, whatever its chunks', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":"é'));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
    );

    expect(await read(response)).toBe('{"a":"é"}');
  });

  it('accepts a body of exactly the cap, and no body at all', async () => {
    expect(await read(new Response('x'.repeat(CAP)))).toBe('x'.repeat(CAP));
    expect(await read(new Response(null))).toBe('');
  });

  it('cancels a body that outgrows the cap, after reading only about the cap', async () => {
    const { state, response } = endlessBody(30);

    await expect(read(response)).rejects.toThrow(AnswerTooLargeError);

    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(10);
  });

  it('refuses before reading when content-length is over the cap, and cancels the body', async () => {
    const { state, response } = endlessBody(30);
    const declared = new Response(response.body, {
      headers: { 'content-length': String(CAP + 1) },
    });

    await expect(read(declared)).rejects.toThrow(AnswerTooLargeError);

    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it('does not trust a content-length that is under the cap but lies', async () => {
    const { state, response } = endlessBody(30);
    const lying = new Response(response.body, { headers: { 'content-length': '5' } });

    await expect(read(lying)).rejects.toThrow(AnswerTooLargeError);

    expect(state.cancelled).toBe(true);
  });
});
