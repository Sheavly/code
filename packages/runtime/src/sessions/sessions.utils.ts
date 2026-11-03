import type {
  InboxMessage,
  SessionState,
  SessionUpdate,
} from '@sheavly/protocol/session/session.types';

/**
 * One server-sent event for a session update: the update type as the SSE event name, the
 * session id as the event id, and the rest of the update (`{ session }`, plus `message` for a
 * `session_message`) as JSON data.
 */
export function toServerSentEvent(update: SessionUpdate): string {
  const { type, ...data } = update;

  return `event: ${type}\nid: ${update.session.id}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** How a queued message reads to the session receiving it. */
export function inboxText(message: InboxMessage): string {
  return message.from === 'user'
    ? message.content
    : `Message from the agent that started you (session ${message.from}), sent while you were working. ` +
        `It updates your task; follow it:\n${message.content}`;
}

/** Whether a session in `state` is still open: running a prompt, or idle waiting for the next. */
export function isOpen(state: SessionState): boolean {
  return state === 'running' || state === 'idle';
}
