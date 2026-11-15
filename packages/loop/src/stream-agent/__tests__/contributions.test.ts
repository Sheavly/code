import { describe, expect, it } from 'vitest';
import { ContributionError } from '../../errors/loop.errors.js';
import { orderContributions, runContribution } from '../contributions.helper.js';
import { buildContributions } from '../turn-contributions.helper.js';
import { summarizeHistory } from '../../summary/summarize.helper.js';
import type { Contribution } from '../contributions.types.js';
import type { AgentOptions } from '../stream-agent.types.js';

const make = (
  name: string,
  extra: Partial<Contribution<number, number>> = {},
): Contribution<number, number> => ({
  name,
  onFailure: 'report',
  abort: 'race',
  run: (n) => n + 1,
  ...extra,
});

describe('orderContributions', () => {
  it('keeps the given order, and puts a contribution after the ones it names', () => {
    const list = [make('c', { after: ['a'] }), make('a'), make('b', { after: ['c'] })];

    expect(orderContributions(list).map((item) => item.name)).toEqual(['a', 'c', 'b']);
    expect(orderContributions([make('x'), make('y')]).map((item) => item.name)).toEqual(['x', 'y']);
  });

  it.each([
    ['duplicate', [make('a'), make('a')]],
    ['unknown_after', [make('a', { after: ['missing'] })]],
    ['cycle', [make('a', { after: ['b'] }), make('b', { after: ['a'] })]],
  ] as const)('refuses a %s, naming the problem', (problem, list) => {
    expect(() => orderContributions(list)).toThrow(ContributionError);
    expect(() => orderContributions(list)).toThrow(expect.objectContaining({ problem }));
  });
});

describe('runContribution', () => {
  const live = new AbortController().signal;

  it('returns the value of a contribution that succeeds', async () => {
    const report = () => expect.unreachable();

    await expect(
      runContribution({ contribution: make('a'), input: 1, signal: live, report }),
    ).resolves.toEqual({ value: 2 });
  });

  it('reports a failing contribution and gives no value when onFailure is report', async () => {
    const reported: string[] = [];
    const broken = make('broken', {
      run: () => {
        throw new Error('nope');
      },
    });

    await expect(
      runContribution({
        contribution: broken,
        input: 1,
        signal: live,
        report: ({ name }) => reported.push(name),
      }),
    ).resolves.toEqual({ value: undefined });
    expect(reported).toEqual(['broken']);
  });

  it('rethrows a failing contribution when onFailure is fail-run', async () => {
    const strict = make('strict', {
      onFailure: 'fail-run',
      run: () => Promise.reject(new Error('fatal')),
    });

    await expect(
      runContribution({ contribution: strict, input: 1, signal: live, report: () => undefined }),
    ).rejects.toThrow('fatal');
  });

  it('with abort race, stops waiting once the run aborts and reports nothing', async () => {
    const stop = new AbortController();
    const reported: string[] = [];
    const stuck = make('stuck', { run: () => new Promise<number>(() => undefined) });
    const running = runContribution({
      contribution: stuck,
      input: 1,
      signal: stop.signal,
      report: ({ name }) => reported.push(name),
    });

    stop.abort();
    await expect(running).resolves.toEqual({ value: undefined });
    expect(reported).toEqual([]);
  });

  it('with abort wait, lets the contribution finish after the run aborts', async () => {
    const stop = new AbortController();
    const slow = make('slow', {
      abort: 'wait',
      run: async (n) => {
        await Promise.resolve();

        return n + 10;
      },
    });
    const running = runContribution({
      contribution: slow,
      input: 1,
      signal: stop.signal,
      report: () => undefined,
    });

    stop.abort();
    await expect(running).resolves.toEqual({ value: 11 });
  });

  it('does not report a failure that is only the run being aborted', async () => {
    const stop = new AbortController();
    const reported: string[] = [];
    const aborting = make('aborting', {
      run: () => {
        stop.abort();
        throw new Error('aborted');
      },
    });

    await runContribution({
      contribution: aborting,
      input: 1,
      signal: stop.signal,
      report: ({ name }) => reported.push(name),
    });
    expect(reported).toEqual([]);
  });
});

describe('buildContributions', () => {
  const options = (summary: boolean) =>
    ({ ...(summary ? { summary: {} } : {}) }) as unknown as AgentOptions;

  it('has no masking or overflow recovery without a summary option: absent, not switched off', () => {
    const built = buildContributions(options(false));

    expect(built.view).toEqual([]);
    expect(built.overflow).toEqual([]);
  });

  it('registers masking before the model call and overflow recovery with a summary option', () => {
    const built = buildContributions(options(true));

    expect(built.view.map((item) => item.name)).toEqual(['mask-old-tool-output']);
    expect(built.overflow.map((item) => item.name)).toEqual(['summarize-on-overflow']);
  });

  it('always registers the limit phase in order: window first, then output recovery', () => {
    expect(buildContributions(options(false)).limit.map((item) => item.name)).toEqual([
      'window-exceeded',
      'output-limit',
    ]);
  });

  it('gives every contribution a failure and an abort policy', () => {
    const built = buildContributions(options(true));

    for (const item of [...built.view, ...built.overflow, ...built.limit]) {
      expect(['fail-run', 'report']).toContain(item.onFailure);
      expect(['race', 'wait']).toContain(item.abort);
    }

    expect(typeof summarizeHistory).toBe('function');
  });
});
