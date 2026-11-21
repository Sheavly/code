import { describe, expect, it } from 'vitest';
import { createClient } from '../client.helper.js';
import { REFUSAL_MAX_BYTES } from '../refusal.constants.js';

const FRAME = JSON.stringify({ error: { code: 'forbidden', message: '' } });
const FRAME_BYTES = new TextEncoder().encode(FRAME).length;

/** A refusal body of exactly `bytes` bytes whose message is `filler` repeated, padded with 'a'. */
function bodyOf(params: { bytes: number; filler: string }): string {
  const { bytes, filler } = params;
  const fillerBytes = new TextEncoder().encode(filler).length;
  const copies = Math.floor((bytes - FRAME_BYTES) / fillerBytes);
  const pad = 'a'.repeat(bytes - FRAME_BYTES - copies * fillerBytes);
  const body = JSON.stringify({
    error: { code: 'forbidden', message: `${pad}${filler.repeat(copies)}` },
  });

  expect(new TextEncoder().encode(body).length).toBe(bytes);

  return body;
}

async function refusalOf(body: string): Promise<unknown> {
  const client = createClient({
    url: 'http://server.test',
    token: 'secret-token-0123456789',
    fetch: () => Promise.resolve(new Response(body, { status: 403 })),
  });

  return client.call('listConversations', {}).catch((caughtError: unknown) => caughtError);
}

describe('a private route refusal at the bound', () => {
  it('keeps its message when the body is exactly the bound', async () => {
    const failure = await refusalOf(bodyOf({ bytes: REFUSAL_MAX_BYTES, filler: 'a' }));

    expect(failure).toMatchObject({ name: 'RefusedError', status: 403, code: 'forbidden' });
    expect((failure as Error).message).toHaveLength(REFUSAL_MAX_BYTES - FRAME_BYTES);
  });

  it('answers with the fixed message when the body is one byte over the bound', async () => {
    const failure = await refusalOf(bodyOf({ bytes: REFUSAL_MAX_BYTES + 1, filler: 'a' }));

    expect(failure).toMatchObject({ name: 'RefusedError', status: 403 });
    expect((failure as Error).message).toBe('The backend answered 403');
  });

  it('answers with the fixed message when a multi-byte character straddles the bound', async () => {
    const body = bodyOf({ bytes: REFUSAL_MAX_BYTES + 1, filler: 'é' });
    const failure = await refusalOf(body);

    expect(failure).toMatchObject({ name: 'RefusedError', status: 403 });
    expect((failure as Error).message).toBe('The backend answered 403');
  });

  it('keeps its message when a multi-byte character ends exactly at the bound', async () => {
    const failure = await refusalOf(bodyOf({ bytes: REFUSAL_MAX_BYTES, filler: '€' }));

    expect(failure).toMatchObject({ name: 'RefusedError', status: 403, code: 'forbidden' });
    expect((failure as Error).message).toContain('€');
  });
});
