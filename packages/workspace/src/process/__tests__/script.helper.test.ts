import { beforeEach, describe, expect, it } from 'vitest';
import { ProcessInterruptedError } from '../../errors/process.errors.js';
import { ProcessRunner } from '../process.service.js';
import type { ScriptStep } from '../process.types.js';
import { runScript } from '../script.helper.js';

let runner: ProcessRunner;

beforeEach(() => {
  runner = new ProcessRunner({ env: process.env });
});

type Parts = readonly (readonly string[] | string)[];

/** Steps from commands and the connectors between them: `[cmd, '|', cmd, '&&', cmd]`. */
function stepsOf(parts: Parts): [ScriptStep, ...ScriptStep[]] {
  const steps: ScriptStep[] = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      const last = steps.at(-1);

      if (last) last.joinedBy = part as '|';
    } else {
      steps.push({ argv: part as ScriptStep['argv'] });
    }
  }

  return steps as [ScriptStep, ...ScriptStep[]];
}

const script = (parts: Parts, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
  runScript({
    run: (params) => runner.run(params),
    script: {
      steps: stepsOf(parts),
      cwd: process.cwd(),
      signal: extra.signal ?? new AbortController().signal,
      ...(extra.timeoutMs !== undefined && { timeoutMs: extra.timeoutMs }),
    },
  });

describe('runScript pipes', () => {
  it('feeds one command’s output to the next', async () => {
    const result = await script([['printf', 'a\\nb\\nc\\n'], '|', ['head', '-n', '2']]);

    expect(result).toEqual({ exitCode: 0, output: 'a\nb\n', timedOut: false });
  });

  it('stops a command whose reader has gone, as a shell does with SIGPIPE', async () => {
    const result = await script([['yes'], '|', ['head', '-n', '3']], { timeoutMs: 10_000 });

    expect(result).toMatchObject({ exitCode: 0, output: 'y\ny\ny\n', timedOut: false });
    expect(runner.running).toBe(0);
  });

  it('passes everything through, not only what the result keeps', async () => {
    const result = await script([['yes'], '|', ['head', '-n', '100000'], '|', ['wc', '-l']]);

    expect(result.output.trim()).toBe('100000');
  });

  it('chains more than two', async () => {
    const result = await script([
      ['printf', 'b\\na\\nb\\n'],
      '|',
      ['sort'],
      '|',
      ['uniq'],
      '|',
      ['head', '-n', '1'],
    ]);

    expect(result.output).toBe('a\n');
  });

  it('reports the last command’s exit code, as a shell does without pipefail', async () => {
    expect((await script([['false'], '|', ['true']])).exitCode).toBe(0);
    expect((await script([['true'], '|', ['false']])).exitCode).toBe(1);
  });

  it('keeps standard error in the output, not in the pipe', async () => {
    const result = await script([['ls', '/no-such-folder-for-sheavly'], '|', ['cat']]);

    expect(result.output).toContain('no-such-folder-for-sheavly');
    expect(result.exitCode).toBe(0);
  });
});

describe('runScript lists', () => {
  it.each([
    [[['true'], '&&', ['echo', 'yes']], 'yes\n', 0],
    [[['false'], '&&', ['echo', 'no']], '', 1],
    [[['false'], '||', ['echo', 'yes']], 'yes\n', 0],
    [[['true'], '||', ['echo', 'no']], '', 0],
    [[['echo', 'a'], ';', ['false']], 'a\n', 1],
    [[['false'], ';', ['echo', 'b']], 'b\n', 0],
    [[['true'], '&&', ['echo', 'a'], '||', ['echo', 'b']], 'a\n', 0],
    [[['false'], '&&', ['echo', 'a'], '||', ['echo', 'b']], 'b\n', 0],
    [[['false'], '&&', ['echo', 'a'], ';', ['echo', 'c']], 'c\n', 0],
    [[['echo', 'a'], ';', ['echo', 'b'], ';', ['echo', 'c']], 'a\nb\nc\n', 0],
  ] as const)('runs %j as a shell would', async (parts, output, exitCode) => {
    expect(await script(parts)).toEqual({ exitCode, output, timedOut: false });
  });

  it('runs a pipe and a list together', async () => {
    const result = await script([
      ['printf', 'x\\ny\\n'],
      '|',
      ['head', '-n', '1'],
      '&&',
      ['echo', 'done'],
    ]);

    expect(result.output).toBe('x\ndone\n');
  });
});

describe('runScript without a shell', () => {
  it('takes every word as it is: no expansion, no second command', async () => {
    const result = await script([['echo', '$HOME', ';', 'echo', '`id`', '&&', 'x']]);

    expect(result.output).toBe('$HOME ; echo `id` && x\n');
  });
});

describe('runScript limits', () => {
  it('counts the timeout over the whole script, and starts nothing after it', async () => {
    const started = performance.now();
    const result = await script([['sleep', '5'], ';', ['echo', 'after']], { timeoutMs: 300 });

    expect(result).toMatchObject({ timedOut: true });
    expect(result.output).not.toContain('after');
    expect(performance.now() - started).toBeLessThan(3000);
    expect(runner.running).toBe(0);
  });

  it('stops every command of a pipe at the timeout', async () => {
    const result = await script([['sleep', '5'], '|', ['cat']], { timeoutMs: 300 });

    expect(result.timedOut).toBe(true);
    expect(runner.running).toBe(0);
  });

  it('throws when it was already interrupted, running nothing', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(script([['echo', 'x']], { signal: controller.signal })).rejects.toBeInstanceOf(
      ProcessInterruptedError,
    );
  });

  it('stops keeping output past the limit, but streams all of it', async () => {
    const seen: string[] = [];
    const result = await runScript({
      run: (params) => runner.run(params),
      script: {
        steps: stepsOf([['yes'], '|', ['head', '-c', '100000']]),
        cwd: process.cwd(),
        signal: new AbortController().signal,
        onOutput: (chunk) => seen.push(chunk),
      },
    });

    expect(result.output.length).toBeLessThanOrEqual(30_000);
    expect(result.output).toContain('lines omitted');
    expect(seen.join('').length).toBe(100_000);
  });
});

describe('runScript failures', () => {
  it('fails with the error and stops the rest of the pipe when a command cannot start', async () => {
    await expect(script([['no-such-program-for-sheavly'], '|', ['cat']])).rejects.toThrow('ENOENT');
    expect(runner.running).toBe(0);
  });

  it('does not run the next list item after a command that cannot start', async () => {
    const seen: string[] = [];

    await expect(
      runScript({
        run: (params) => runner.run(params),
        script: {
          steps: stepsOf([['no-such-program-for-sheavly'], ';', ['echo', 'after']]),
          cwd: process.cwd(),
          signal: new AbortController().signal,
          onOutput: (chunk) => seen.push(chunk),
        },
      }),
    ).rejects.toThrow('ENOENT');
    expect(seen).toEqual([]);
  });
});
