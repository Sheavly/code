import { describe, expect, it } from 'vitest';
import type { AgentEventBody } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { NOTICE_LIFETIMES } from '@sheavly/protocol/notice/notice.constants';
import { NOTICE_SAMPLES } from '@sheavly/testing/notice/notice-samples.fake';
import { OrderedQueue } from '../../queue/queue.service.js';
import { publishNotice } from '../notice-publish.helper.js';

const KINDS = Object.keys(NOTICE_LIFETIMES) as (keyof typeof NOTICE_SAMPLES)[];

function publish(kind: keyof typeof NOTICE_SAMPLES) {
  const released: AgentEventBody[] = [];
  const events = new OrderedQueue<AgentEventBody>({ onRelease: (event) => released.push(event) });
  const messages: HistoryMessage[] = [];

  publishNotice({ events, messages, notice: NOTICE_SAMPLES[kind], at: 7 });

  return { released, messages };
}

describe('publishNotice', () => {
  it.each(KINDS)('%s: the stream always hears it', (kind) => {
    const { released } = publish(kind);

    expect(released).toMatchObject([{ type: 'harness_notice', notice: NOTICE_SAMPLES[kind] }]);
  });

  it.each(KINDS)('%s: history keeps it exactly when the registry says persistent', (kind) => {
    const { messages } = publish(kind);

    expect(messages).toEqual(
      NOTICE_LIFETIMES[kind] === 'persistent'
        ? [{ role: 'notice', notice: NOTICE_SAMPLES[kind], at: 7 }]
        : [],
    );
  });
});
