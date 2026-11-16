import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessKillError } from '../../errors/process.errors.js';
import { ProcessRunner } from '../process.service.js';

const signal = new AbortController().signal;
/** A fresh runner per test, so no live group or exit hook leaks into the next one. */
let runner: ProcessRunner;
const printEnv = (env: Record<string, string> = {}) =>
  runner.run({ file: 'env', args: [], cwd: process.cwd(), shell: false, signal, env });

beforeEach(() => {
  runner = new ProcessRunner({ env: process.env });
});

describe('ProcessRunner kill', () => {
  it('fails the command with a ProcessKillError when its group cannot be killed', async () => {
    const controller = new AbortController();
    const eperm = Object.assign(new Error('not permitted'), { code: 'EPERM' });
    const running = runner.run({
      file: 'sleep',
      args: ['5'],
      cwd: process.cwd(),
      shell: false,
      signal: controller.signal,
    });
    const realKill = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw eperm;
    });

    controller.abort();

    const failure = await running.catch((caughtError: unknown) => caughtError);

    kill.mockRestore();
    if (failure instanceof ProcessKillError) realKill(-failure.pid, 'SIGKILL'); // clean up
    expect(failure).toBeInstanceOf(ProcessKillError);
    expect(failure).toMatchObject({ code: 'EPERM', cause: eperm });
  });
});

describe('ProcessRunner timeout', () => {
  const sleep = (extra: { timeoutMs?: number; signal?: AbortSignal }) =>
    runner.run({
      file: 'sleep',
      args: ['5'],
      cwd: process.cwd(),
      shell: false,
      signal,
      ...extra,
    });

  it('kills the group at timeoutMs and reports timedOut, as runScript does', async () => {
    expect(await sleep({ timeoutMs: 100 })).toMatchObject({ exitCode: null, timedOut: true });
    expect(runner.running).toBe(0);
  });

  it('does not report a cancel as a timeout, even with a deadline set', async () => {
    const controller = new AbortController();
    const running = sleep({ timeoutMs: 10_000, signal: controller.signal });

    controller.abort();

    expect(await running).toMatchObject({ exitCode: null, timedOut: false });
  });

  it('rejects, rather than throwing, for a timeout that cannot be set', async () => {
    await expect(sleep({ timeoutMs: -1 })).rejects.toThrow();
    expect(runner.running).toBe(0);
  });

  it('refuses to start when the caller has already aborted', async () => {
    await expect(sleep({ timeoutMs: 100, signal: AbortSignal.abort() })).rejects.toThrow();
  });
});

describe('ProcessRunner env', () => {
  it('decodes UTF-8 split across output chunks without corrupting text', async () => {
    const chunks: string[] = [];
    const result = await runner.run({
      file: process.execPath,
      args: [
        '-e',
        "const bytes = Buffer.from('🙂'); process.stdout.write(bytes.subarray(0, 2)); setTimeout(() => process.stdout.write(bytes.subarray(2)), 20)",
      ],
      cwd: process.cwd(),
      shell: false,
      signal,
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.output).toBe('🙂');
    expect(chunks.join('')).toBe('🙂');
  });

  it('caps large returned output but still streams every byte to the callback', async () => {
    let streamed = 0;
    const result = await runner.run({
      file: process.execPath,
      args: [
        '-e',
        "process.stdout.write('FIRST\\n' + ('x'.repeat(2000) + '\\n').repeat(1000) + 'FINAL')",
      ],
      cwd: process.cwd(),
      shell: false,
      signal,
      onOutput: (chunk) => {
        streamed += chunk.length;
      },
    });

    expect(streamed).toBeGreaterThan(2_000_000);
    expect(result.output.length).toBeLessThanOrEqual(30_000);
    expect(result.output.startsWith('FIRST\n')).toBe(true);
    expect(result.output.endsWith('FINAL')).toBe(true);
    expect(result.output).toContain('lines omitted');
  });

  it('starts from the environment it was given, without what looks like a secret', async () => {
    runner = new ProcessRunner({
      env: { PATH: process.env.PATH, HARNESS_TEST_API_KEY: 'hunter2', HARNESS_TEST_PLAIN: 'kept' },
    });

    const { output } = await printEnv();

    expect(output).toContain('HARNESS_TEST_PLAIN=kept');
    expect(output).not.toContain('hunter2');
  });

  it('adds `env` on top, overriding an inherited value', async () => {
    runner = new ProcessRunner({
      env: { PATH: process.env.PATH, HARNESS_TEST_PLAIN: 'inherited' },
    });

    const { output } = await printEnv({ HARNESS_TEST_PLAIN: 'override', HARNESS_TEST_NEW: '1' });

    expect(output).toContain('HARNESS_TEST_PLAIN=override');
    expect(output).toContain('HARNESS_TEST_NEW=1');
    expect(output).not.toContain('inherited');
  });
});

describe('ProcessRunner groups', () => {
  it('tracks a running group, and removes its exit hook once nothing runs', async () => {
    const before = process.listenerCount('exit');
    const running = runner.run({
      file: 'true',
      args: [],
      cwd: process.cwd(),
      shell: false,
      signal,
    });

    expect(runner.running).toBe(1);
    expect(process.listenerCount('exit')).toBe(before + 1);

    await running;

    expect(runner.running).toBe(0);
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('keeps each runner separate: another one tracks none of these groups', async () => {
    const other = new ProcessRunner({ env: process.env });
    const running = runner.run({
      file: 'true',
      args: [],
      cwd: process.cwd(),
      shell: false,
      signal,
    });

    expect(other.running).toBe(0);
    await running;
  });
});
