import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { findRunningServer } from '../server-finder.helper.js';
import type { FinderVerify, FinderVerifyParams, FoundServer } from '../server-finder.types.js';
import { SAMPLE_TOKEN, useFinderPlace } from '../testing/server-finder.fake.js';

const place = useFinderPlace();
const posix = describe.skipIf(process.platform === 'win32');
const SHORT_MS = 60;
const MISMATCH = {
  status: 'version_mismatch',
  older: 'server',
  client: '2.0.0',
  server: '1.0.0',
  message: 'The server is older: update it.',
} as const;

async function serve(): Promise<void> {
  const directory = await place.runtimeFolder();

  await place.hold({ directory });
  await place.publish({ directory });
}

async function find(params: {
  verify: unknown;
  log?: (line: string) => void;
}): Promise<FoundServer> {
  return findRunningServer({
    home: place.home(),
    env: place.env(),
    uid: place.uid,
    platform: 'linux',
    verify: params.verify as FinderVerify,
    timeoutMs: SHORT_MS,
    ...(params.log && { log: params.log }),
  });
}

const answering = (answer: unknown) => () => Promise.resolve(answer);
const failingWith = (failure: Error) => () => Promise.reject(failure);
const never = () => new Promise<never>(() => undefined);

function named(name: unknown): Error {
  const failure = new Error('x');

  Object.defineProperty(failure, 'name', { value: name });

  return failure;
}

function throwingName(): Error {
  const failure = new Error('x');

  Object.defineProperty(failure, 'name', {
    get: () => {
      throw new Error(SAMPLE_TOKEN);
    },
  });

  return failure;
}

/** The reasons of the runtime folder, the only one that holds a server in these tests. */
const reasons = (result: FoundServer) =>
  result.status === 'none' ? result.reasons.filter((reason) => reason.problem !== 'no-file') : [];

posix('findRunningServer with an injected handshake that lies', () => {
  it('builds a version mismatch from its four fields, never copying others', async () => {
    await serve();

    const result = await find({
      verify: answering({ ...MISMATCH, token: SAMPLE_TOKEN, extra: 1 }),
    });

    expect(result).toStrictEqual(MISMATCH);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'verified'],
    ['a number', 42],
    ['an object with no status', {}],
    ['an unknown status', { status: 'welcome' }],
    ['a verified answer without a protocol version', { status: 'verified' }],
    ['a mismatch with a wrong side', { ...MISMATCH, older: 'both' }],
    ['a mismatch with a missing field', { status: 'version_mismatch', older: 'client' }],
    ['a verified answer quoting the token', { status: 'verified', protocolVersion: SAMPLE_TOKEN }],
    ['a mismatch quoting the token', { ...MISMATCH, message: `update ${SAMPLE_TOKEN}` }],
  ])('reads %s as no handshake instead of rejecting', async (_title, answer) => {
    await serve();

    const result = await find({ verify: answering(answer) });

    expect(reasons(result)).toEqual([expect.objectContaining({ problem: 'no-handshake' })]);
  });

  it('reads an answer whose field cannot be read as no handshake', async () => {
    await serve();

    const hostile = {
      get status(): string {
        throw new Error(SAMPLE_TOKEN);
      },
    };

    expect(reasons(await find({ verify: answering(hostile) }))).toEqual([
      expect.objectContaining({ problem: 'no-handshake' }),
    ]);
  });

  it('names a failure only when its name is allow-listed', async () => {
    await serve();

    const cases = [
      [named('VerifyTimeoutError'), 'VerifyTimeoutError'],
      [named('RangeError'), 'RangeError'],
      [named(SAMPLE_TOKEN), 'an unknown failure'],
      [named(42), 'an unknown failure'],
      [throwingName(), 'an unknown failure'],
    ] as const;

    for (const [failure, shown] of cases) {
      const lines: string[] = [];
      const result = await find({ verify: failingWith(failure), log: (line) => lines.push(line) });

      expect(reasons(result)[0]).toMatchObject({ problem: 'no-answer' });
      expect(reasons(result)[0]?.message).toContain(`(${shown})`);
      expect(lines.join('\n') + JSON.stringify(result)).not.toContain(SAMPLE_TOKEN);
    }
  });

  it('gives up on a handshake that never settles and aborts its signal', async () => {
    await serve();

    let seen: FinderVerifyParams | undefined;
    const verify = (params: FinderVerifyParams) => {
      seen = params;

      return never();
    };
    const result = await find({ verify });

    expect(reasons(result)).toEqual([expect.objectContaining({ problem: 'no-answer' })]);
    expect(reasons(result)[0]?.message).toContain('TimeoutError');
    expect(seen?.signal?.aborted).toBe(true);
  });

  it('gives up on a handshake that throws before returning a promise', async () => {
    await serve();

    const verify = () => {
      throw new TypeError(SAMPLE_TOKEN);
    };

    expect(reasons(await find({ verify }))).toEqual([
      expect.objectContaining({ problem: 'no-answer' }),
    ]);
  });
});

posix('what findRunningServer returns for any handshake', () => {
  const liar = {
    toString: () => SAMPLE_TOKEN,
    token: SAMPLE_TOKEN,
    cause: new Error(SAMPLE_TOKEN),
  };
  const outcomes: [string, unknown][] = [
    ['extra token fields', answering({ ...MISMATCH, ...liar })],
    ['a token as name', failingWith(named(SAMPLE_TOKEN))],
    ['a token as message', failingWith(new Error(SAMPLE_TOKEN))],
    ['a token as cause', failingWith(new Error('x', { cause: SAMPLE_TOKEN }))],
    ['a token as toString', failingWith(Object.assign(new Error('x'), liar))],
    ['undefined', answering(undefined)],
    ['a never settling handshake', never],
    ['a throwing getter', failingWith(throwingName())],
    [
      'a verified answer with extra fields',
      answering({ status: 'verified', protocolVersion: '1', ...liar }),
    ],
  ];

  it.each(outcomes)('holds the token only in a verified result: %s', async (_title, verify) => {
    await serve();

    const lines: string[] = [];
    const result = await find({ verify, log: (line) => lines.push(line) });
    const shown = result.status === 'found' ? { ...result, token: '' } : result;
    const printed = [
      JSON.stringify(shown),
      inspect(shown, { depth: 8, showHidden: true }),
      ...lines,
    ].join('\n');

    expect(printed).not.toContain(SAMPLE_TOKEN);
  });
});
