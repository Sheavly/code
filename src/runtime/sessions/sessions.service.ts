import { randomUUID } from 'node:crypto';
import { MAX_SESSION_DEPTH } from './sessions.constants.js';
import { toServerSentEvent } from './sessions.utils.js';
import { SessionError } from '../errors/sessions.errors.js';
import type {
  InboxMessage,
  SessionInfo,
  SessionRef,
  SessionState,
  SessionUpdate,
} from '@sheavly/protocol/session/session.types';

type Listener = (update: SessionUpdate) => void;

/**
 * Every session of one main run, as a tree: the main session, its sub-agents and theirs. A
 * sub-agent can only start under a running session that is in this registry, so none floats free,
 * and never deeper than `MAX_SESSION_DEPTH`. Status reports and endings are pushed to listeners,
 * and streamed as server-sent events for a UI (`stream()`).
 */
export class SessionRegistry {
  #sessions = new Map<string, SessionInfo>();
  #listeners = new Set<Listener>();
  /** Messages queued per session, delivered at its next model call. */
  #inboxes = new Map<string, InboxMessage[]>();
  /** Loops waiting idle (for tasks) that a new message should wake. */
  #waiters = new Map<string, (() => void)[]>();

  /** Starts the main session (depth 1). */
  startMain(params: { title: string; id?: string }): SessionRef {
    const id = params.id ?? randomUUID();

    return this.#add({ id, rootId: id, depth: 1, title: params.title });
  }

  /** Starts a sub-agent session under `parentId`. Throws if the parent is unknown or ended, or at the depth cap. */
  startChild(params: { parentId: string; title: string }): SessionRef {
    const { parentId, title } = params;
    const parent = this.#sessions.get(parentId);

    if (!parent) {
      throw new SessionError({
        reason: 'unknown_session',
        sessionId: parentId,
        message: `Unknown parent session ${parentId}: a sub-agent must belong to a session`,
      });
    }

    if (parent.state !== 'running') {
      throw new SessionError({
        reason: 'parent_ended',
        sessionId: parentId,
        message: `Parent session ${parentId} has ended (${parent.state}); it cannot start sub-agents`,
      });
    }

    if (parent.depth >= MAX_SESSION_DEPTH) {
      throw new SessionError({
        reason: 'too_deep',
        sessionId: parentId,
        message: `Sub-agents nest at most ${MAX_SESSION_DEPTH} levels (main session → sub-agent → sub-agent); session ${parentId} is at depth ${parent.depth}`,
      });
    }

    return this.#add({
      id: randomUUID(),
      parentId,
      rootId: parent.rootId,
      depth: parent.depth + 1,
      title,
    });
  }

  /** A sub-agent's own status report ("editing core package"). Ignored once the session ended. */
  report(params: { id: string; status: string }): void {
    const session = this.#require(params.id);

    if (session.state !== 'running') return;
    session.status = params.status;
    this.#emit({ type: 'session_status', session });
  }

  /** Marks a session ended with how its run finished. Ending twice keeps the first ending. */
  end(params: { id: string; state: Exclude<SessionState, 'running'> }): void {
    const session = this.#require(params.id);

    if (session.state !== 'running') return;
    session.state = params.state;
    session.endedAt = Date.now();
    this.#emit({ type: 'session_ended', session });
    this.#wake(params.id); // nobody waits on an ended session's inbox
  }

  /**
   * Queues a message for a running session; its loop delivers it at the next model call, without
   * stopping anything. `from` is `'user'`, or a session id, which must be an ancestor of the
   * target: a session steers only its own sub-agents (and theirs). Throws otherwise.
   */
  send(params: { id: string; content: string; from: string }): void {
    const { id, content, from } = params;
    const session = this.#require(id);

    if (session.state !== 'running') {
      throw new SessionError({
        reason: 'session_ended',
        sessionId: id,
        message: `Session ${id} has ended (${session.state}); it can't receive messages`,
      });
    }

    if (from !== 'user' && !this.lineage(id).some((s) => s.id === from && s.id !== id)) {
      throw new SessionError({
        reason: 'not_an_ancestor',
        sessionId: id,
        message: `Session ${from} did not start session ${id} (directly or through a sub-agent)`,
      });
    }

    const message: InboxMessage = { from, content, sentAt: Date.now() };

    this.#inboxes.set(id, [...(this.#inboxes.get(id) ?? []), message]);
    this.#emit({ type: 'session_message', session, message });
    this.#wake(id);
  }

  /** Removes and returns the session's queued messages, oldest first. */
  takeMessages(id: string): InboxMessage[] {
    const messages = this.#inboxes.get(id) ?? [];

    this.#inboxes.delete(id);

    return messages;
  }

  hasMessages(id: string): boolean {
    return (this.#inboxes.get(id)?.length ?? 0) > 0;
  }

  /** Resolves when a message arrives for the session (or it ends). For a loop waiting idle. */
  nextMessage(id: string): Promise<void> {
    return new Promise((resolve) => {
      this.#waiters.set(id, [...(this.#waiters.get(id) ?? []), resolve]);
    });
  }

  get(id: string): SessionInfo | undefined {
    const session = this.#sessions.get(id);

    return session && { ...session };
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((session) => ({ ...session }));
  }

  /** The sessions `id` started directly. */
  children(id: string): SessionInfo[] {
    return this.list().filter((session) => session.parentId === id);
  }

  /** `id` and every ancestor, up to the main session (last). */
  lineage(id: string): SessionInfo[] {
    const chain: SessionInfo[] = [];
    let current = this.get(id);

    while (current) {
      chain.push(current);
      current = current.parentId === undefined ? undefined : this.get(current.parentId);
    }

    return chain;
  }

  /** Calls `listener` for every update from now on. Returns a function that stops it. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Updates as server-sent events (`text/event-stream`), for an HTTP response body:
   * `new Response(sessions.stream({ signal }), { headers: { 'content-type': 'text/event-stream' } })`.
   * Starts with every known session (so a late UI catches up), then streams live until `signal`.
   */
  stream(params: { signal?: AbortSignal } = {}): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => undefined;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (update: SessionUpdate) =>
          controller.enqueue(encoder.encode(toServerSentEvent(update)));

        for (const session of this.list()) send({ type: 'session_started', session });
        unsubscribe = this.subscribe(send);
        params.signal?.addEventListener(
          'abort',
          () => {
            unsubscribe();
            controller.close();
          },
          { once: true },
        );
      },
      cancel: () => {
        unsubscribe();
      },
    });
  }

  #add(params: SessionRef & { title: string }): SessionRef {
    const session: SessionInfo = { ...params, state: 'running', startedAt: Date.now() };

    this.#sessions.set(session.id, session);
    this.#emit({ type: 'session_started', session });

    const { id, parentId, rootId, depth } = session;

    return { id, ...(parentId !== undefined && { parentId }), rootId, depth };
  }

  #require(id: string): SessionInfo {
    const session = this.#sessions.get(id);

    if (!session) {
      throw new SessionError({
        reason: 'unknown_session',
        sessionId: id,
        message: `Unknown session ${id}`,
      });
    }

    return session;
  }

  #emit(update: SessionUpdate): void {
    const snapshot = { ...update, session: { ...update.session } };

    for (const listener of this.#listeners) listener(snapshot);
  }

  #wake(id: string): void {
    const waiters = this.#waiters.get(id) ?? [];

    this.#waiters.delete(id);
    waiters.forEach((wake) => wake());
  }
}
