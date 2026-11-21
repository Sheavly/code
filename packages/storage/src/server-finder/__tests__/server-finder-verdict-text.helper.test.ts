import { describe, expect, it } from 'vitest';
import { findRunningServer } from '../server-finder.helper.js';
import type { FinderVerify, FoundServer } from '../server-finder.types.js';
import { SAMPLE_TOKEN, useFinderPlace } from '../testing/server-finder.fake.js';

const place = useFinderPlace();
const posix = describe.skipIf(process.platform === 'win32');
const ESCAPES = '\x1b]0;pwned\x07\x1b[2J\u202Eevil\u200b';
const MISMATCH = {
  status: 'version_mismatch',
  older: 'server',
  client: '2.0.0',
  server: '1.0.0',
  message: 'The server is older: update it.',
} as const;

async function find(params: { answer: unknown; log?: (line: string) => void }) {
  const directory = await place.runtimeFolder();

  await place.hold({ directory });
  await place.publish({ directory });

  return findRunningServer({
    home: place.home(),
    env: place.env(),
    uid: place.uid,
    platform: 'linux',
    verify: (() => Promise.resolve(params.answer)) as FinderVerify,
    timeoutMs: 200,
    ...(params.log && { log: params.log }),
  });
}

const verified = (protocolVersion: string) => ({ status: 'verified', protocolVersion });

function noHandshake(result: FoundServer): boolean {
  return (
    result.status === 'none' && result.reasons.some((reason) => reason.problem === 'no-handshake')
  );
}

posix('a handshake text a command would print', () => {
  it.each([
    ['a 10 MB protocol version', verified('1'.repeat(10_000_000))],
    ['an escape protocol version', verified(ESCAPES)],
    ['a 1 MB message', { ...MISMATCH, message: 'm'.repeat(1_000_000) }],
    ['escapes in the message', { ...MISMATCH, message: ESCAPES }],
    ['escapes in the client', { ...MISMATCH, client: ESCAPES }],
    ['escapes in the server', { ...MISMATCH, server: ESCAPES }],
    ['a line separator', { ...MISMATCH, message: 'a\u2028b' }],
    ['a paragraph separator', { ...MISMATCH, message: 'a\u2029b' }],
    ['a newline', { ...MISMATCH, message: 'a\nb' }],
    ['a 201 character protocol version', verified('1'.repeat(201))],
  ])('reads %s as no handshake', async (_title, answer) => {
    expect(noHandshake(await find({ answer }))).toBe(true);
  });

  it('keeps a semver with a pre-release and build, and a 200 character text', async () => {
    const found = await find({ answer: verified('1.2.3-rc.1+build') });
    const longest = await find({ answer: verified('1'.repeat(200)) });

    expect(found).toMatchObject({ status: 'found', protocolVersion: '1.2.3-rc.1+build' });
    expect(longest).toMatchObject({ status: 'found', protocolVersion: '1'.repeat(200) });
  });

  it('keeps a mismatch with a 150 character message and its two sides', async () => {
    const message = 'update the server. '.repeat(8).slice(0, 150);

    expect(await find({ answer: { ...MISMATCH, message } })).toStrictEqual({
      ...MISMATCH,
      message,
    });
  });
});

posix('a log that throws', () => {
  it.each([
    ['on every call', () => new Error('boom')],
    ['the token', () => new Error(SAMPLE_TOKEN)],
  ])('does not change the result: %s', async (_title, failure) => {
    const answer = { status: 'no_handshake' };
    const plain = await find({ answer });
    const result = await find({
      answer,
      log: () => {
        throw failure();
      },
    });

    expect(result).toStrictEqual(plain);
    expect(JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
  });
});
