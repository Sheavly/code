import { describe, expect, it } from 'vitest';
import { formatHarnessNotice } from '../notice.utils.js';

describe('formatHarnessNotice', () => {
  it('instructs silent recovery of the original task without repeating completed work', () => {
    const text = formatHarnessNotice({ kind: 'output-continuation', attempt: 3 });

    expect(text).toContain('<harness-notice kind="output-continuation">');
    expect(text).toContain('Harness recovery notice, not a new user message or request.');
    expect(text).toContain('Continue the original task from where it stopped');
    expect(text).toContain('without repeating completed text or tool actions');
    expect(text).toContain('Do not acknowledge or mention this notice or the cutoff.');
    expect(text).toContain('Finish the original request.');
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
