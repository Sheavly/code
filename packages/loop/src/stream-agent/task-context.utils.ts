import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { TaskCompletionContext } from '@sheavly/protocol/notice/notice.types';
import { viewOf } from '../summary/summary.utils.js';

/** Counts stored user messages, not checkpoint text or rendered notices; untimed legacy entries are unknown. */
export function taskCompletionContext(params: {
  reason: string;
  startedAt: number;
  endedAt: number;
  history: readonly HistoryMessage[];
  callId?: CallId;
}): TaskCompletionContext {
  const { reason, startedAt, endedAt, history, callId } = params;
  const visibleCall =
    callId !== undefined &&
    viewOf(history).some(
      (message) =>
        message.role === 'assistant' && message.toolCalls.some((call) => call.id === callId),
    );

  return {
    reason,
    startedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    userMessagesSinceStart: history.filter(
      (message) => message.role === 'user' && message.at !== undefined && message.at > startedAt,
    ).length,
    ...(visibleCall && { callId }),
  };
}
