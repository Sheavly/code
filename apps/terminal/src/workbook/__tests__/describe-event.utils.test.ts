import { describe, expect, it } from 'vitest';
import { entryEventSchema } from '@sheavly/protocol/event/event.validator';
import { describeEvent } from '../workbook.utils.js';

describe('describeEvent', () => {
  it('describes an extension event by its kind and its fallback text, never its data', () => {
    const event = entryEventSchema.parse({
      seq: 7,
      type: 'extension_event',
      extension: 'acme',
      kind: 'acme.never-heard-of',
      version: 1,
      data: { secretPayload: 'DATA-ONLY-MARKER' },
      text: 'Deploy finished\nsecond line',
    });
    const line = describeEvent(event);

    expect(line).toContain('extension_event');
    expect(line).toContain('acme.never-heard-of · Deploy finished');
    expect(line).not.toContain('second line');
    expect(line).not.toContain('DATA-ONLY-MARKER');
  });
});
