import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';
import { formatTask } from '../tasks.utils.js';

/** 80 lines of 100 characters each: past the 4,000-character tail and every preview limit. */
const MULTILINE =
  'REPORT-BEGIN\n' +
  Array.from({ length: 80 }, (_, index) => `Finding ${String(index)}: ${'e'.repeat(90)}`).join(
    '\n',
  ) +
  '\nREPORT-END';
/** One 1,500-character line: past the 1,000-character line limit of the output buffer. */
const SINGLE_LINE = `REPORT-BEGIN ${'e'.repeat(1_500)} REPORT-END`;

async function finished(params: { report?: string; output?: string }) {
  const tasks = new TaskRegistry();
  const started = tasks.start({
    command: 'sub-agent: research',
    description: 'research',
    run: async ({ onOutput }) => {
      if (params.output) onOutput(params.output);

      return { exitCode: 0, ...(params.report !== undefined && { report: params.report }) };
    },
  });

  await tasks.nextSettled();

  return { tasks, id: started.id };
}

describe('a task report', () => {
  it.each([
    ['a multiline report past the 4,000-character tail', MULTILINE],
    ['a single line past the 1,000-character line limit', SINGLE_LINE],
    ['a report with nothing to shorten', 'short'],
  ])('is kept whole for %s', async (_name, report) => {
    const { tasks, id } = await finished({ report });

    expect(tasks.report(id)).toBe(report);
  });

  it('is kept apart from the output, so progress cannot displace it', async () => {
    const progress = '[status] reading\n'.repeat(5_000);
    const { tasks, id } = await finished({ report: MULTILINE, output: progress });

    expect(tasks.report(id)).toBe(MULTILINE);
    expect(tasks.get(id)?.output).not.toContain('REPORT-BEGIN');
  });

  it('does not enter the task snapshot, so no event carries it', async () => {
    const { tasks, id } = await finished({ report: MULTILINE });

    expect(JSON.stringify(tasks.get(id))).not.toContain('REPORT-BEGIN');
    expect(JSON.stringify(tasks.list())).not.toContain('REPORT-BEGIN');
  });

  it('is undefined for a task that returned none, a task still running, and an unknown id', async () => {
    const shell = await finished({ output: 'done\n' });
    const tasks = new TaskRegistry();
    const running = tasks.start({
      command: 'sleep',
      description: 'wait',
      run: () => new Promise(() => undefined),
    });

    expect(shell.tasks.report(shell.id)).toBeUndefined();
    expect(tasks.report(running.id)).toBeUndefined();
    expect(tasks.report(shell.id)).toBeUndefined();
  });

  it('is not kept for a task that failed with an error', async () => {
    const tasks = new TaskRegistry();
    const started = tasks.start({
      command: 'sub-agent: broken',
      description: 'broken',
      run: async () => {
        throw new Error('boom');
      },
    });

    await tasks.nextSettled();
    expect(tasks.report(started.id)).toBeUndefined();
    expect(tasks.get(started.id)?.error).toBe('boom');
  });
});

describe('formatTask with a report', () => {
  it('shows the report whole, with no tail cut and no omission marker', async () => {
    const { tasks, id } = await finished({ report: MULTILINE, output: '[status] working\n' });
    const task = tasks.get(id);

    expect(task).toBeDefined();

    const text = formatTask({ task: task!, now: 0, report: tasks.report(id) });

    expect(MULTILINE.length).toBeGreaterThan(4_000);
    expect(text).toContain(MULTILINE);
    expect(text).not.toContain('[…]');
    expect(text).not.toContain('[status]');
  });

  it('keeps a shell task’s bounded tail as it was', async () => {
    // 200 lines of 100 characters: the buffer keeps about 100 of them, past the 4,000-character tail.
    const { tasks, id } = await finished({ output: `${`${'x'.repeat(99)}\n`.repeat(200)}END` });
    const task = tasks.get(id);

    expect(task).toBeDefined();

    const text = formatTask({ task: task!, now: 0 });

    expect(text).toContain('[…]');
    expect(text.endsWith('END')).toBe(true);
    expect(text.length).toBeLessThan(4_200);
  });
});
