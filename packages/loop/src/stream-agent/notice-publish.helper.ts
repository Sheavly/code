import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { isPersistentNotice } from '@sheavly/protocol/notice/notice.utils';
import type { AgentEvents } from './stream-agent.types.js';

/**
 * Sends a notice to the stream and, when its kind is persistent, keeps it in `messages` too. The
 * lifetime comes from the registry (`NOTICE_LIFETIMES`), so no call site decides it. The event
 * goes first: the stream and history carry the same payload in the same order.
 */
export function publishNotice(params: {
  events: AgentEvents;
  messages: HistoryMessage[];
  notice: HarnessNotice;
  at: number;
}): void {
  const { events, messages, notice, at } = params;

  events.enqueue({ type: 'harness_notice', notice });
  if (isPersistentNotice(notice)) messages.push({ role: 'notice', notice, at });
}
