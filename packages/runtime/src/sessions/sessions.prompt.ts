import type { InboxMessage } from '@sheavly/protocol/session/session.types';

/** Labels parent-origin steering without changing the supplied message text. */
export function parentInboxText(message: InboxMessage): string {
  return (
    `Message from the agent that started you (session ${message.from}), sent while you were working. ` +
    `It updates your task; follow it:\n${message.content}`
  );
}
