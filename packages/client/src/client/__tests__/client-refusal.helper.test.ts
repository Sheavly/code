import { describe, expect, it } from 'vitest';
import { RefusedError } from '../../errors/client.errors.js';
import { createClient } from '../client.helper.js';
import { REFUSAL_MAX_BYTES } from '../refusal.constants.js';

const CHUNK = 1024;
const LIMIT_CHUNKS = 20_000;
const refusedWith = (fetch: () => Promise<Response>) =>
  createClient({ url: 'http://server.test', token: 'secret-token-0123456789', fetch }).call(
    'listConversations',
    {},
  );

/**
 * A body no sane client reads to the end (it closes only after `LIMIT_CHUNKS`, so a client with
 * no bound fails the test instead of hanging it), counting the chunks pulled and whether it was
 * cancelled.
 */
function endlessBody() {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      state.pulled += 1;

      if (state.pulled > LIMIT_CHUNKS) {
        controller.close();

        return;
      }

      controller.enqueue(new Uint8Array(CHUNK).fill(65));
    },
    cancel: () => {
      state.cancelled = true;
    },
  });

  return { state, body };
}

describe('a private route refusal', () => {
  it('keeps its status, code and message when the body is small', async () => {
    const fetch = () =>
      Promise.resolve(
        Response.json({ error: { code: 'forbidden', message: 'no' } }, { status: 403 }),
      );

    await expect(refusedWith(fetch)).rejects.toMatchObject({
      name: 'RefusedError',
      status: 403,
      code: 'forbidden',
      message: 'no',
    });
  });

  it('is not read at all when its declared length is over the bound', async () => {
    const { state, body } = endlessBody();
    const fetch = () =>
      Promise.resolve(
        new Response(body, {
          status: 500,
          headers: { 'content-length': String(50_000_000) },
        }),
      );
    const failure = await refusedWith(fetch).catch((caughtError: unknown) => caughtError);

    expect(failure).toBeInstanceOf(RefusedError);
    expect(failure).toMatchObject({ status: 500, message: 'The backend answered 500' });
    expect(state.cancelled).toBe(true);
    expect(state.pulled * CHUNK).toBeLessThanOrEqual(2 * CHUNK);
  });

  it('stops reading a body that never ends at the bound and answers with a fixed message', async () => {
    const { state, body } = endlessBody();
    const fetch = () => Promise.resolve(new Response(body, { status: 502 }));
    const failure = await refusedWith(fetch).catch((caughtError: unknown) => caughtError);

    expect(failure).toBeInstanceOf(RefusedError);
    expect(failure).toMatchObject({ status: 502, message: 'The backend answered 502' });
    expect(state.cancelled).toBe(true);
    expect(state.pulled * CHUNK).toBeLessThanOrEqual(REFUSAL_MAX_BYTES + 2 * CHUNK);
  });
});
