import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectBackend } from '../backend.helper.js';

/**
 * What a started backend reads: an empty folder of its own as the user's (`SHEAVLY_HOME`), so the
 * developer's real profiles are never touched. It has no profile, and it starts all the same: a
 * UI has to reach a running backend to set it up. (No model is called.)
 */
const env = {
  ...process.env,
  SHEAVLY_HOME: path.join(tmpdir(), 'backend-helper-test-home'),
  BACKEND_URL: '',
  BACKEND_TOKEN: '',
};

describe('connectBackend', () => {
  it('starts with the backend config even when the terminal passes a relative tsx config', async () => {
    const terminalEnv = { ...env, TSX_TSCONFIG_PATH: 'apps/terminal/tsconfig.json' };
    let output = '';
    const backend = await connectBackend({
      env: terminalEnv,
      onOutput: (text) => (output += text),
    });

    try {
      expect(output).toContain('→ listening on');
      expect(terminalEnv.TSX_TSCONFIG_PATH).toBe('apps/terminal/tsconfig.json');
    } finally {
      await backend.stop();
    }
  }, 30_000);

  it('starts a backend through npm, on a free port with its own token, and stops it', async () => {
    let output = '';
    const backend = await connectBackend({ env, onOutput: (text) => (output += text) });
    const listed = await fetch(`${backend.url}/conversations`, {
      headers: { authorization: `Bearer ${backend.token}` },
    });

    expect(backend.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(listed.status).toBe(200);
    expect(output).toContain('→ listening on');
    // The token was made here and handed over in the environment: never printed.
    expect(output).not.toContain(backend.token);

    await backend.stop();
    await expect(fetch(`${backend.url}/conversations`)).rejects.toThrow();
  }, 30_000);

  it('connects to a backend already running, and leaves it running', async () => {
    const backend = await connectBackend({
      env: { BACKEND_URL: 'http://127.0.0.1:4310', BACKEND_TOKEN: 'a-token' },
      onOutput: () => undefined,
    });

    expect(backend).toMatchObject({ url: 'http://127.0.0.1:4310', token: 'a-token' });
    await expect(backend.stop()).resolves.toBeUndefined();
  });

  it('refuses a backend URL without its token', async () => {
    await expect(
      connectBackend({ env: { BACKEND_URL: 'http://127.0.0.1:4310' }, onOutput: () => undefined }),
    ).rejects.toThrow('Set BACKEND_TOKEN');
  });

  it('says so when the backend exits before it listens', async () => {
    await expect(
      connectBackend({
        // A setting the backend cannot accept fails as it reads its settings, before it listens.
        env: { ...env, MAX_TURNS: '0' },
        onOutput: () => undefined,
      }),
    ).rejects.toThrow('exited');
  }, 30_000);
});
