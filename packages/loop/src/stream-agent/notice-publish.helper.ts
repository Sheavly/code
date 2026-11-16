import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { isPersistentNotice } from '@sheavly/protocol/notice/notice.utils';
import type { AgentEvents } from './stream-agent.types.js';

/**
 * The history entries for `notice`: one when its kind is persistent, none when it is transient.
 * The lifetime comes from the registry (`NOTICE_LIFETIMES`), so no call site decides it; the one
 * place a `{ role: 'notice' }` entry is written.
 */
export function noticeEntries(params: { notice: HarnessNotice; at: number }): HistoryMessage[] {
  const { notice, at } = params;

  return isPersistentNotice(notice) ? [{ role: 'notice', notice, at }] : [];
}

/**
 * Sends a notice to the stream and keeps its entry in `messages` when its kind is persistent. The
 * event goes first: the stream and history carry the same payload in the same order.
 */
export function publishNotice(params: {
  events: AgentEvents;
  messages: HistoryMessage[];
  notice: HarnessNotice;
  at: number;
}): void {
  const { events, messages, notice, at } = params;

  events.enqueue({ type: 'harness_notice', notice });
  messages.push(...noticeEntries({ notice, at }));
}
