/**
 * Why a call on the live conversations failed, for a transport to map to its own errors (the
 * server's codes): no conversation has that id, a skill a prompt picked doesn't exist, or a model
 * to switch to isn't one the conversation has.
 */
type ConversationFailure = 'not_found' | 'unknown_skill' | 'unknown_model';

export class ConversationsError extends Error {
  override name = 'ConversationsError';
  readonly reason: ConversationFailure;

  constructor(params: { reason: ConversationFailure; message: string; cause?: unknown }) {
    const { reason, message, cause } = params;

    super(message, { cause });
    this.reason = reason;
  }
}
