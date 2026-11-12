import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';

type UserMessage = Extract<Message, { role: 'user' }>;

/**
 * Where the latest request is in stored history, or -1. A request is a stored `user` entry: a
 * harness notice is its own `notice` role there, and only becomes a `user`-role message in what a
 * model is sent, so a notice can never be taken for one.
 */
export function latestRequestIndex(history: readonly HistoryMessage[]): number {
  return history.findLastIndex((entry) => entry.role === 'user');
}

/** Where the latest prompt a person typed is (the host gives those an `id`), or -1. */
export function latestPromptIndex(history: readonly HistoryMessage[]): number {
  return history.findLastIndex((entry) => entry.role === 'user' && entry.id !== undefined);
}

/** The latest request in stored history, which a summary must keep word for word. */
export function latestRequest(history: readonly HistoryMessage[]): UserMessage | undefined {
  const entry = history[latestRequestIndex(history)];

  return entry?.role === 'user' ? entry : undefined;
}
