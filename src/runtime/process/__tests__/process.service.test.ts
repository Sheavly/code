import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProcess } from '../process.service.js';

const signal = new AbortController().signal;
const printEnv = (env: Record<string, string> = {}) =>
  runProcess({ file: 'env', args: [], cwd: process.cwd(), shell: false, signal, env });

afterEach(() => {
  vi.unstubAllEnvs();
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
