import { createHash } from 'node:crypto';
import type { MessagesApiMessage } from './messages.types.js';

/** Only system, tools and preceding messages bind a thinking signature, not effort or limits. */
export function messagesPrefix(params: {
  instructions: string | undefined;
  tools: Record<string, unknown>[];
  messages: MessagesApiMessage[];
}): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex');
}
