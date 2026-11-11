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

  it('keeps an explicit wait reason without adding one to an ungrouped or legacy task', () => {
    expect(taskInfoSchema.parse(TASK)).not.toHaveProperty('reason');
    expect(taskInfoSchema.parse({ ...TASK, reason: 'Compare the test results' }).reason).toBe(
      'Compare the test results',
    );
    expect(taskInfoSchema.parse({ ...TASK, reason: '' }).reason).toBe('');
  });

  it.each([undefined, null, 123])('rejects a present invalid reason: %j', (reason) => {
    expect(taskInfoSchema.safeParse({ ...TASK, reason }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(taskInfoSchema.safeParse({ ...TASK, status: 'paused' }).success).toBe(false);
  });
});
