import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { ContextUsage } from '@sheavly/protocol/usage/usage.types';

/** Tracks only the main session's latest call; duplicate streams and stale refreshes cannot rewind it. */
export class ContextUsageTracker {
  #snapshot: ContextUsage;

  constructor(
    readonly mainSession: SessionId,
    initial?: ContextUsage,
  ) {
    this.#snapshot = initial ? { ...initial } : { throughSeq: -1 };
  }

  get snapshot(): ContextUsage {
    return { ...this.#snapshot };
  }

  update(snapshot: ContextUsage): void {
    if (snapshot.throughSeq >= this.#snapshot.throughSeq) this.#snapshot = { ...snapshot };
  }

  observe(entry: StreamEntry): void {
    if (entry.sessionId !== this.mainSession || entry.seq <= this.#snapshot.throughSeq) return;
    if (entry.kind !== 'event' || entry.event.type !== 'usage') return;

    // The call that wrote a summary is billed, but its tokens are not the conversation's context.
    if (entry.event.usage.purpose === 'summary') return;

    const { tokens, contextWindow } = entry.event.usage;

    this.#snapshot = {
      throughSeq: entry.seq,
      ...(tokens && { used: tokens.inputTokens + tokens.outputTokens }),
      ...(contextWindow !== undefined && { window: contextWindow }),
    };
  }
}
