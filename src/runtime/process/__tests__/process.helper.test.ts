import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessKillError } from '../../errors/process.errors.js';
import { runProcess } from '../process.helper.js';

const signal = new AbortController().signal;
const printEnv = (env: Record<string, string> = {}) =>
  runProcess({ file: 'env', args: [], cwd: process.cwd(), shell: false, signal, env });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runProcess kill', () => {
  it('fails the command with a ProcessKillError when its group cannot be killed', async () => {
    const controller = new AbortController();
    const eperm = Object.assign(new Error('not permitted'), { code: 'EPERM' });
    const running = runProcess({
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

describe('runProcess env', () => {
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
