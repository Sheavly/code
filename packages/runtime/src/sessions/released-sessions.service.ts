import type { SessionId, SessionInfo } from '@sheavly/protocol/session/session.types';

/**
 * What a registry keeps of a session it released: that it existed, who started it and when. That
 * tells a released id from one that never existed, lets a filter on a parent's subtree still
 * match the entries a released sub-agent left in the combined stream, and keeps its place in
 * start order for readers of stored history.
 */
export class ReleasedSessions {
  readonly #kept = new Map<SessionId, { parent: SessionId | undefined; startedAt: number }>();

  record(session: SessionInfo): void {
    this.#kept.set(session.id, {
      parent: 'parentId' in session ? session.parentId : undefined,
      startedAt: session.startedAt,
    });
  }

  has(id: SessionId): boolean {
    return this.#kept.has(id);
  }

  /** Every released session's id and start time. */
  starts(): { id: SessionId; startedAt: number }[] {
    return [...this.#kept].map(([id, { startedAt }]) => ({ id, startedAt }));
  }

  /** The session that started `id`; none for the main session and for an id never released. */
  parentOf(id: SessionId): SessionId | undefined {
    return this.#kept.get(id)?.parent;
  }
}
