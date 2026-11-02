import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessKillError } from '../../errors/process.errors.js';
import { ProcessRunner } from '../process.service.js';

const signal = new AbortController().signal;
/** A fresh runner per test, so no live group or exit hook leaks into the next one. */
let runner: ProcessRunner;
const printEnv = (env: Record<string, string> = {}) =>
  runner.run({ file: 'env', args: [], cwd: process.cwd(), shell: false, signal, env });

beforeEach(() => {
  runner = new ProcessRunner();
});

afterEach(() => {
  vi.unstubAllEnvs();
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

describe('ProcessRunner env', () => {
  it('drops env vars that look like secrets', async () => {
    vi.stubEnv('HARNESS_TEST_API_KEY', 'hunter2');
    vi.stubEnv('HARNESS_TEST_PLAIN', 'kept');

    const { output } = await printEnv();

    expect(output).toContain('HARNESS_TEST_PLAIN=kept');
    expect(output).not.toContain('hunter2');
  });

  it('adds `env` on top, overriding an inherited value', async () => {
    vi.stubEnv('HARNESS_TEST_PLAIN', 'inherited');

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
    const other = new ProcessRunner();
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
