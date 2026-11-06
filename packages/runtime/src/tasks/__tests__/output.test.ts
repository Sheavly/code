import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';

describe('task output previews', () => {
  it('bounds live snapshots and keeps early context and the final result', async () => {
    const tasks = new TaskRegistry();
    let finish: () => void = () => undefined;
    const task = tasks.start({
      command: 'build',
      description: 'Build',
      run: async ({ onOutput }) => {
        onOutput('FIRST\n');
        onOutput(('x'.repeat(2000) + '\n').repeat(1000));
        onOutput('FINAL');
        await new Promise<void>((resolve) => {
          finish = resolve;
        });

        return { exitCode: 0 };
      },
    });

    const live = tasks.get(task.id);

    expect(live?.output.length).toBeLessThanOrEqual(30_000);
    expect(live?.output).toContain('FIRST\n');
    expect(live?.output).toContain('lines omitted');
    expect(live?.output.endsWith('FINAL')).toBe(true);
    finish();
    await tasks.cancel(task.id);
    expect(tasks.get(task.id)?.output.endsWith('FINAL')).toBe(true);
  });
});
