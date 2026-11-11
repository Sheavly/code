import type { AgentEvent, EntryEvent } from '@sheavly/protocol/event/event.types';
import { parentInboxText } from './sessions.prompt.js';
import type {
  InboxMessage,
  SessionInfo,
  SessionRef,
  SessionState,
  SessionUpdate,
} from '@sheavly/protocol/session/session.types';

/**
 * Who a session is, without its state: the main session's id, root and depth, or a sub-agent's
 * with the session and call that started it. What a run is handed to run as.
 */
export function refOf(session: SessionInfo): SessionRef {
  if (!('parentId' in session)) return { id: session.id, rootId: session.rootId, depth: 1 };

  const { id, parentId, startedByCall, rootId, depth } = session;

  return { id, parentId, startedByCall, rootId, depth };
}

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
  if (message.from === 'user') return message.content;

  return parentInboxText(message);
}

/** Whether a session in `state` is still open: running a prompt, or idle waiting for the next. */
export function isOpen(state: SessionState): boolean {
  return state === 'running' || state === 'idle';
}

/**
 * An event as the combined stream keeps it: `done` without its `messages`, which hold the whole
 * history so far and would make the stream grow with the square of a long conversation.
 */
export function toEntryEvent(event: AgentEvent): EntryEvent {
  if (event.type !== 'done') return event;

  const { messages: _history, ...done } = event;

  return done;
}
