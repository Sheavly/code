import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { commandServiceWork, commandTaskWork } from '../command-work.utils.js';

const input = {
  command: 'sleep 1',
  description: 'wait',
  sessionId: sessionIdSchema.parse('main'),
  run: async () => ({ exitCode: 0 }),
};

describe('the command work kinds', () => {
  it('a task is finite and a service is not', () => {
    expect(commandTaskWork(input).backgroundKind).toBe('task');
    expect(commandServiceWork(input).backgroundKind).toBe('service');
  });
});
