import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BackendError } from '../../errors/backend.errors.js';
import { TRUST_REASON_MAX_CHARS } from '../client.constants.js';
import type { Backend } from '../client.types.js';
import { trustFolderOnAttached } from '../trust-attached.helper.js';

const TOKEN = 'a-token-that-must-never-be-printed-0123456789';
const ESC = String.fromCodePoint(27);
const BEL = String.fromCodePoint(7);
const MAX_MESSAGE_CHARS = 300;

/** A backend that refuses with 403 and `message` as its text, as a hostile one may. */
function refusingWith(message: string): Backend {
  return {
    url: 'http://backend.test',
    token: TOKEN,
    attached: true,
    stop: async () => undefined,
    fetch: () =>
      Promise.resolve(Response.json({ error: { code: 'forbidden', message } }, { status: 403 })),
  };
}

async function refusalOf(message: string): Promise<BackendError> {
  const failure = await trustFolderOnAttached({
    backend: refusingWith(message),
    args: ['--trust'],
    workspace: '/work',
    env: {},
    write: () => undefined,
  }).catch((caughtError: unknown) => caughtError);

  expect(failure).toBeInstanceOf(BackendError);

  return failure as BackendError;
}

function expectSafeLine(failure: BackendError): void {
  const { message } = failure;

  expect(message).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  expect(message).not.toContain(TOKEN);
  expect(inspect(failure, { depth: 8, showHidden: true })).not.toContain(TOKEN);
}

describe('the refusal --trust prints', () => {
  it('shows escape and OSC sequences as visible text, not as control characters', async () => {
    const failure = await refusalOf(`${ESC}[31mred${ESC}]0;owned${BEL} and\ttab`);

    expectSafeLine(failure);
    expect(failure.message).toContain('403');
  });

  it('is cut to one line of at most 200 characters, with an ellipsis', async () => {
    const failure = await refusalOf('x'.repeat(3000));

    expectSafeLine(failure);
    expect(failure.message).toContain(`${'x'.repeat(TRUST_REASON_MAX_CHARS)}…`);
    expect(failure.message).not.toContain('x'.repeat(TRUST_REASON_MAX_CHARS + 1));
  });

  it.each([
    ['a body of a megabyte', 'y'.repeat(1_000_000)],
    ['a hundred thousand line breaks', 'line\n'.repeat(100_000)],
    ['a hundred thousand carriage returns', 'line\r'.repeat(100_000)],
  ])('stays one short line for %s', async (_title, message) => {
    expectSafeLine(await refusalOf(message));
  });

  it('keeps only the first line of a message of several', async () => {
    const failure = await refusalOf('first line\nsecond line\nthird');

    expect(failure.message).toContain('first line');
    expect(failure.message).not.toContain('second');
  });

  it('hides the token however often the backend echoes it', async () => {
    const failure = await refusalOf(`bad ${TOKEN} and again ${TOKEN}`);

    expectSafeLine(failure);
    expect(failure.message).toContain('[token hidden]');
  });

  it('hides a token that a control character was meant to hide from the first pass', async () => {
    const half = Math.floor(TOKEN.length / 2);
    const failure = await refusalOf(`${TOKEN.slice(0, half)}${ESC}${TOKEN.slice(half)}`);

    expectSafeLine(failure);
  });

  it('hides a token echoed after a line break or past the cap', async () => {
    expectSafeLine(await refusalOf(`short\n${TOKEN}`));
    expectSafeLine(await refusalOf(`${'z'.repeat(190)}${TOKEN}`));
  });
});
