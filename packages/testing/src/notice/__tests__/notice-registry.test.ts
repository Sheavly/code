import { describe, expect, it } from 'vitest';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { NOTICE_LIFETIMES } from '@sheavly/protocol/notice/notice.constants';
import { isPersistentNotice, noticeLifetime } from '@sheavly/protocol/notice/notice.utils';
import { persistentNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { entryEventSchema } from '@sheavly/protocol/event/event.validator';
import { NOTICE_SAMPLES } from '../notice-samples.fake.js';

const KINDS = Object.keys(NOTICE_LIFETIMES) as (keyof typeof NOTICE_SAMPLES)[];

describe('the notice lifetime registry', () => {
  it('has a sample for every kind and nothing else', () => {
    expect(Object.keys(NOTICE_SAMPLES).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)('%s: history accepts it exactly when the registry calls it persistent', (kind) => {
    const notice = NOTICE_SAMPLES[kind];
    const persistent = noticeLifetime(notice) === 'persistent';

    expect(persistentNoticeSchema.safeParse(notice).success).toBe(persistent);
    expect(isPersistentNotice(notice)).toBe(persistent);
    expect(historyMessageSchema.safeParse({ role: 'notice', notice, at: 1 }).success).toBe(
      persistent,
    );
  });

  it.each(KINDS)('%s: the formatter writes it for the model', (kind) => {
    expect(formatHarnessNotice(NOTICE_SAMPLES[kind])).toContain(kind);
  });

  it.each(KINDS)('%s: the stream carries it whatever its lifetime', (kind) => {
    const event = { type: 'harness_notice', seq: 0, notice: NOTICE_SAMPLES[kind] };

    expect(entryEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
});
