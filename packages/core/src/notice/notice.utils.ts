import type { HarnessNotice } from './notice.types.js';

const count = new Intl.NumberFormat('en-US');

/** Formats trusted harness data with its origin and handling policy, never as a user request. */
export function formatHarnessNotice(notice: HarnessNotice | string): string {
  // Retain the legacy transport while callers migrate to typed notices.
  if (typeof notice === 'string') return notice;

  switch (notice.kind) {
    case 'context-usage':
      return [
        '<harness-notice kind="context-usage">',
        'Harness telemetry, not a user message or request.',
        contextDescription(notice.context),
        'Use this silently to manage the task. Do not acknowledge, repeat, or attribute it to the user unless context limits affect the task.',
        '</harness-notice>',
      ].join('\n');
  }
}

function contextDescription(context: HarnessNotice['context']): string {
  const { window, used } = context;

  if (window !== undefined && used !== undefined) {
    const percent = Math.round((used / window) * 100);

    return `Context: ${count.format(used)} of ${count.format(window)} tokens used (${String(percent)}%)`;
  }

  if (window !== undefined) return `Context: ${count.format(window)} token window`;

  return `Context: ${count.format(used)} tokens used`;
}
