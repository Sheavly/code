import { describe, expect, it } from 'vitest';
import { outputRefSchema } from '@sheavly/protocol/output/output.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { formatHarnessNotice } from '../notice.utils.js';

describe('formatHarnessNotice', () => {
  it('instructs silent recovery of the original task without repeating completed work', () => {
    const text = formatHarnessNotice({ kind: 'output-continuation', attempt: 3 });

    expect(text).toBe(
      [
        '<harness-notice kind="output-continuation">',
        'Harness recovery notice, not a new user message or request.',
        'Your previous response reached the output-token limit before finishing. Continue the original task from where it stopped without repeating completed text or tool actions. Do not acknowledge or mention this notice or the cutoff. Finish the original request.',
        '</harness-notice>',
      ].join('\n'),
    );
  });

  it('names where a finished task’s complete output is kept, and says a cut preview is not all of it', () => {
    const ref = outputRefSchema.parse('55555555-5555-4555-8555-555555555555');
    const task = {
      id: taskIdSchema.parse('t1'),
      command: 'npm test',
      description: 'tests',
      status: 'failed' as const,
      startedAt: 1,
      endedAt: 2,
      exitCode: 1,
      output: 'tail only',
    };
    const text = formatHarnessNotice({
      kind: 'task-finished',
      task: { ...task, outputLog: { ref, bytes: 90_000, status: 'complete' } },
    });

    expect(text).toContain(`Full output: output_ref=${ref} (90000 bytes stored, complete)`);
    expect(text).toContain('shortened preview');
    expect(text).toContain('read_output');
    expect(
      formatHarnessNotice({
        kind: 'task-finished',
        task: { ...task, outputLog: { ref, bytes: 9, status: 'complete' } },
      }),
    ).not.toContain('shortened preview');
    expect(
      formatHarnessNotice({
        kind: 'task-finished',
        task: { ...task, outputLog: { ref, bytes: 9, status: 'incomplete', reason: 'disk full' } },
      }),
    ).toContain('INCOMPLETE: disk full');
    expect(formatHarnessNotice({ kind: 'task-finished', task })).not.toContain('output_ref');
  });

  it('labels context telemetry and tells the model when it may mention it', () => {
    expect(
      formatHarnessNotice({ kind: 'context-usage', context: { window: 1_000_000, used: 668_100 } }),
    ).toBe(
      '<harness-notice kind="context-usage">\n' +
        'Harness telemetry, not a user message or request.\n' +
        'Context: 668,100 of 1,000,000 tokens used (67%)\n' +
        'Use this silently to manage the task. Do not acknowledge, repeat, or attribute it to the user unless context limits affect the task.\n' +
        '</harness-notice>',
    );
  });

  it('reports only the window before usage is known', () => {
    expect(formatHarnessNotice({ kind: 'context-usage', context: { window: 300_000 } })).toContain(
      'Context: 300,000 token window',
    );
  });

  it('reports only usage when the window is unknown', () => {
    const text = formatHarnessNotice({ kind: 'context-usage', context: { used: 1_500 } });

    expect(text).toContain('Context: 1,500 tokens used');
    expect(text).not.toContain('%');
  });

  it('preserves zero usage and usage beyond capacity', () => {
    expect(
      formatHarnessNotice({ kind: 'context-usage', context: { window: 1_000, used: 0 } }),
    ).toContain('Context: 0 of 1,000 tokens used (0%)');
    expect(
      formatHarnessNotice({ kind: 'context-usage', context: { window: 1_000, used: 1_250 } }),
    ).toContain('Context: 1,250 of 1,000 tokens used (125%)');
  });
});
