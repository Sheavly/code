import { describe, expect, it } from 'vitest';
import { commandServiceWork, commandTaskWork, commandWork } from '../command-work.utils.js';

const input = { command: 'sleep 1', description: 'wait', run: async () => ({ exitCode: 0 }) };

describe('the command work kinds', () => {
  it('a task is finite and a service is not', () => {
    expect(commandTaskWork(input).backgroundKind).toBe('task');
    expect(commandServiceWork(input).backgroundKind).toBe('service');
  });

  it.each(['task', 'service'] as const)('maps the model choice %s to its kind', (kind) => {
    expect(commandWork({ kind, input }).backgroundKind).toBe(kind);
  });
});
