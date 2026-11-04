/**
 * Why a call on the live conversations failed, for a transport to map to its own errors (the
 * server's codes): no conversation has that id, a skill a prompt picked doesn't exist, a model to
 * switch to isn't one the conversation has, or its storage failed (the conversation is refused
 * rather than carried on unrecorded).
 */
type ConversationFailure = 'not_found' | 'unknown_skill' | 'unknown_model' | 'storage_failed';

export class ConversationsError extends Error {
  override name = 'ConversationsError';
  readonly reason: ConversationFailure;

  constructor(params: { reason: ConversationFailure; message: string; cause?: unknown }) {
    const { reason, message, cause } = params;

    super(message, { cause });
    this.reason = reason;
  }
}
