import { describe, expect, it } from 'vitest';
import { taskInfoSchema } from '../task.validator.js';

describe('taskInfoSchema', () => {
  const TASK = {
    id: 'task-1',
    command: 'npm test',
    description: 'running the tests',
    status: 'completed',
    startedAt: 1,
    endedAt: 2,
    output: 'ok',
  };

  it('accepts a finished task, with a null exit code when a signal stopped it', () => {
    expect(taskInfoSchema.parse({ ...TASK, exitCode: 0 })).toEqual({ ...TASK, exitCode: 0 });
    expect(taskInfoSchema.parse({ ...TASK, exitCode: null }).exitCode).toBeNull();
  });

  it('rejects an unknown status', () => {
    expect(taskInfoSchema.safeParse({ ...TASK, status: 'paused' }).success).toBe(false);
  });
});
