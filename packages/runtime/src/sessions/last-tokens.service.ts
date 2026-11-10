import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TokenUsage } from '@sheavly/protocol/usage/usage.types';
import type { SessionTokens } from './sessions.types.js';

/**
 * What each session's last model call reported, for the loop to tell the agent how full its
 * context is. Kept here, not in a run, because a conversation's next prompt is a new run on the
 * same session, and a restored conversation has no run at all yet.
 */
export class LastTokens {
  #tokens = new Map<SessionId, TokenUsage>();

  constructor(restored: readonly SessionTokens[] = []) {
    for (const { sessionId, tokens } of restored) this.#tokens.set(sessionId, tokens);
  }

  /**
   * Notes a session's event: a `usage` event replaces what was known. A call that reported no
   * usage clears it, since the old numbers no longer say how full the context is.
   */
  observe(params: { sessionId: SessionId; event: EntryEvent }): void {
    const { sessionId, event } = params;

    if (event.type !== 'usage') return;

    if (event.usage.tokens) this.#tokens.set(sessionId, event.usage.tokens);
    else this.#tokens.delete(sessionId);
  }

  /** Drops what is known about a session, like a call that reported no usage. */
  forget(id: SessionId): void {
    this.#tokens.delete(id);
  }

  /** The tokens of the session's last model call, or none when it has made none that reported. */
  get(id: SessionId): TokenUsage | undefined {
    return this.#tokens.get(id);
  }

  /** Every known session's tokens, for a stored log to carry on from. */
  entries(): SessionTokens[] {
    return [...this.#tokens].map(([sessionId, tokens]) => ({ sessionId, tokens }));
  }
}
