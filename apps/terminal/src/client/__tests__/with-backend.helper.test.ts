import { describe, expect, it, vi } from 'vitest';
import { connectBackend } from '../backend.helper.js';
import type { Backend } from '../client.types.js';
import { withBackend } from '../with-backend.helper.js';

vi.mock('../backend.helper.js', () => ({ connectBackend: vi.fn() }));

function fakeBackend(): Backend {
  return { url: 'http://127.0.0.1:1', token: 'token', stop: vi.fn(async () => undefined) };
}

const options = { env: {}, onOutput: () => undefined };

describe('withBackend', () => {
  it('stops the backend after the work returns', async () => {
    const backend = fakeBackend();

    vi.mocked(connectBackend).mockResolvedValue(backend);
    await expect(withBackend({ options, run: async () => 'done' })).resolves.toBe('done');
    expect(backend.stop).toHaveBeenCalledOnce();
  });

  it('stops the backend when the work throws, and rethrows', async () => {
    const backend = fakeBackend();

    vi.mocked(connectBackend).mockResolvedValue(backend);
    await expect(
      withBackend({
        options,
        run: () => Promise.reject(new Error('boom')),
      }),
    ).rejects.toThrow('boom');
    expect(backend.stop).toHaveBeenCalledOnce();
  });
});
