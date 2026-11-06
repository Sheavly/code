import { describe, expect, it } from 'vitest';
import { openSession } from '../session.helper.js';

describe('resume argument validation', () => {
  it.each([['--resume'], ['--resume', 'not-a-uuid']])(
    'refuses invalid resume arguments before starting a backend: %j',
    async (...args) => {
      await expect(openSession({ env: {}, args, write: () => undefined })).rejects.toThrow(
        '--resume requires a conversation id',
      );
    },
  );
});
