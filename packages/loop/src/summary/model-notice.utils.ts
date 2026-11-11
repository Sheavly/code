import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { noticeForView, visibleCallIds } from './notice-view.utils.js';

/**
 * Resolves pointers for unchanged, known notice entries against the final input. Hooks start with
 * pointer-free text, so edited or ambiguous entries can safely remain without a pointer.
 */
export function withNoticeCallReferences(params: {
  history: readonly HistoryMessage[];
  source: readonly Message[];
  messages: readonly Message[];
}): readonly Message[] {
  const { history, source, messages } = params;
  const callIds = visibleCallIds(messages);

  if (callIds.size === 0) return messages;

  const sourceKeys = new Set(source.filter(isUnidentifiedUser).map(messageKey));
  // A person's identical text must never be reinterpreted as a typed harness notice.
  const userKeys = new Set(history.filter((entry) => entry.role === 'user').map(messageKey));
  const notices = new Map<string, HarnessNotice>();

  for (const entry of history) {
    if (entry.role !== 'notice') continue;

    const content = formatHarnessNotice(
      noticeForView({ notice: entry.notice, callIds: new Set() }),
    );
    const key = messageKey({ content, ...(entry.at !== undefined && { at: entry.at }) });

    if (sourceKeys.has(key) && !userKeys.has(key)) notices.set(key, entry.notice);
  }

  return messages.map((message) => {
    if (!isUnidentifiedUser(message)) return message;

    const notice = notices.get(messageKey(message));

    if (!notice) return message;

    return {
      ...message,
      content: formatHarnessNotice(noticeForView({ notice, callIds })),
    };
  });
}

function isUnidentifiedUser(message: Message): boolean {
  return message.role === 'user' && message.id === undefined;
}

function messageKey(message: Pick<Message, 'content' | 'at'>): string {
  return JSON.stringify([message.at, message.content]);
}
