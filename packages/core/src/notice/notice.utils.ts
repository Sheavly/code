import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { CONTEXT_USAGE_NOTICE_TEXT } from './notice.constants.js';

const count = new Intl.NumberFormat('en-US');

/** Formats trusted harness data with its origin and handling policy, never as a user request. */
export function formatHarnessNotice(notice: HarnessNotice): string {
  switch (notice.kind) {
    case 'context-usage':
      return [
        CONTEXT_USAGE_NOTICE_TEXT.opening,
        CONTEXT_USAGE_NOTICE_TEXT.origin,
        contextDescription(notice.context),
        CONTEXT_USAGE_NOTICE_TEXT.guidance,
        CONTEXT_USAGE_NOTICE_TEXT.closing,
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
