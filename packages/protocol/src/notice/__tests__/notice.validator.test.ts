import { describe, expect, it } from 'vitest';
import { harnessNoticeSchema } from '../notice.validator.js';
import { agentEventSchema, entryEventSchema } from '../../event/event.validator.js';
import { contractJsonSchema } from '../../contract/contract.utils.js';

describe('harness notices on the wire', () => {
  it.each([
    { window: 1_000_000 },
    { used: 0 },
    { window: 1_000_000, used: 668_100 },
    { window: 1_000, used: 1_250 },
  ])('preserves the known counts in %j without adding presentation', (context) => {
    const notice = { kind: 'context-usage', context };
    const event = { type: 'harness_notice', seq: 0, notice };

    expect(harnessNoticeSchema.parse(notice)).toEqual(notice);
    expect(agentEventSchema.parse(event)).toEqual(event);
    expect(entryEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });

  it.each([
    {},
    { window: 0 },
    { window: -1, used: 100 },
    { window: 1.5, used: 100 },
    { window: 10_000_001 },
    { used: -1 },
    { used: 1.5 },
    { used: null },
    { window: '1000', used: 10 },
  ])('rejects unknown or invalid measurements in %j', (context) => {
    expect(harnessNoticeSchema.safeParse({ kind: 'context-usage', context }).success).toBe(false);
  });

  it('rejects arbitrary prose and notice kinds outside the shared contract', () => {
    expect(harnessNoticeSchema.safeParse('Context: 67%').success).toBe(false);
    expect(harnessNoticeSchema.safeParse({ kind: 'toast', context: { used: 100 } }).success).toBe(
      false,
    );
  });

  it('exports the notice schema for clients that do not use TypeScript', () => {
    expect(contractJsonSchema().$defs).toHaveProperty('HarnessNotice');
  });
});
