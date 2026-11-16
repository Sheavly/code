import type { CallId } from '@sheavly/protocol/message/message.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice, TaskCompletionContext } from '@sheavly/protocol/notice/notice.types';

/** Tool results alone cannot establish that a starting call remains visible. */
export function visibleCallIds(messages: readonly HistoryMessage[]): Set<CallId> {
  return new Set(
    messages.flatMap((message) =>
      message.role === 'assistant' ? message.toolCalls.map((call) => call.id) : [],
    ),
  );
}

/** A notice keeps its arrival-time facts, but only points at tool calls this view actually contains. */
export function noticeForView(params: {
  notice: HarnessNotice;
  callIds: ReadonlySet<CallId>;
}): HarnessNotice {
  const { notice, callIds } = params;

  switch (notice.kind) {
    case 'agent-report':
    case 'task-finished':
      return completionForView({ notice, callIds });

    case 'tasks-finished':
      return {
        ...notice,
        context: contextForView({ context: notice.context, callIds }),
        notices: notice.notices.map((member) => completionForView({ notice: member, callIds })),
      };

    default:
      return notice;
  }
}

function completionForView<
  Notice extends Extract<HarnessNotice, { kind: 'agent-report' | 'task-finished' }>,
>(params: { notice: Notice; callIds: ReadonlySet<CallId> }): Notice {
  const { notice, callIds } = params;

  return { ...notice, context: contextForView({ context: notice.context, callIds }) };
}

function contextForView(params: {
  context: TaskCompletionContext;
  callIds: ReadonlySet<CallId>;
}): TaskCompletionContext {
  const { context, callIds } = params;
  const { callId, ...retained } = context;

  if (callId === undefined || callIds.has(callId)) return context;

  return retained;
}
