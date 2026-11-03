import { randomUUID } from 'node:crypto';
import { MAX_SESSION_DEPTH } from './sessions.constants.js';
import { EntryLog } from './entry-log.service.js';
import { Inboxes } from './inboxes.service.js';
import { notifyAll } from './listeners.helper.js';
import { updateStream } from './update-stream.helper.js';
import { isOpen } from './sessions.utils.js';
import { SessionError } from '../errors/sessions.errors.js';
import type {
  InboxMessage,
  RunOutcome,
  SessionId,
  SessionInfo,
  SessionRef,
  SessionUpdate,
} from '@sheavly/protocol/session/session.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { EntryFilter } from './sessions.types.js';

type Listener = (update: SessionUpdate) => void;

/**
 * Every session of one main run, as a tree: the main session, its sub-agents and theirs. A
 * sub-agent can only start under a running session that is in this registry, so none floats free,
 * and never deeper than `MAX_SESSION_DEPTH`. Status reports and endings are pushed to listeners,
 * and streamed as server-sent events for a UI (`stream()`).
 *
 * It also orders the whole tree's activity: every session update and every event a session's
 * loop publishes (`publish`) becomes one `StreamEntry`, numbered 0, 1, 2, ... across all sessions
 * in the order it happened, for a UI following every session at once (`subscribeEntries`).
 */
export class SessionRegistry {
  #sessions = new Map<SessionId, SessionInfo>();
  #listeners = new Set<Listener>();
  #entries = new EntryLog({ lineage: (id) => this.lineage(id) });
  #inboxes = new Inboxes();

  /** Starts the main session (depth 1). */
  startMain(params: { title: string; id?: SessionId }): SessionRef {
    const id = params.id ?? sessionIdSchema.parse(randomUUID());

    return this.#add({ id, rootId: id, depth: 1, title: params.title });
  }

  /** Starts a sub-agent session under `parentId`. Throws if the parent is unknown or ended, or at the depth cap. */
  startChild(params: { parentId: SessionId; title: string }): SessionRef {
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
        message:
          parent.state === 'idle'
            ? `Parent session ${parentId} is idle between prompts; only a running session starts sub-agents`
            : `Parent session ${parentId} has ended (${parent.state}); it cannot start sub-agents`,
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
      id: sessionIdSchema.parse(randomUUID()),
      parentId,
      rootId: parent.rootId,
      depth: parent.depth + 1,
      title,
    });
  }

  /** A sub-agent's own status report ("editing core package"). Ignored once the session ended. */
  report(params: { id: SessionId; status: string }): void {
    const session = this.#require(params.id);

    if (session.state !== 'running') return;
    session.status = params.status;
    this.#emit({ type: 'session_status', session });
  }

  /**
   * Ends a running or idle session for good, with how its last run finished. Ending twice keeps
   * the first ending.
   */
  end(params: { id: SessionId; state: RunOutcome }): void {
    const session = this.#require(params.id);

    if (!isOpen(session.state)) return;
    session.state = params.state;
    session.lastOutcome = params.state;
    session.endedAt = Date.now();
    this.#emit({ type: 'session_ended', session });
    this.#inboxes.wake(params.id); // nobody waits on an ended session's inbox
  }

  /**
   * A conversation's prompt finished, and the session stays open for the next: `outcome` is how
   * that run ended. Only a running session goes idle; otherwise this does nothing.
   */
  idle(params: { id: SessionId; outcome: RunOutcome }): void {
    const session = this.#require(params.id);

    if (session.state !== 'running') return;
    session.state = 'idle';
    session.lastOutcome = params.outcome;
    this.#emit({ type: 'session_idle', session });
  }

  /** The next prompt of a conversation starts: an idle session runs again. Throws otherwise. */
  resume(id: SessionId): void {
    const session = this.#require(id);

    if (session.state !== 'idle') {
      throw new SessionError({
        reason: session.state === 'running' ? 'session_running' : 'session_ended',
        sessionId: id,
        message: `Session ${id} is ${session.state}; only an idle session can take its next prompt`,
      });
    }

    session.state = 'running';
    this.#emit({ type: 'session_resumed', session });
  }

  /**
   * Queues a message for a running or idle session; its loop delivers it at the next model call
   * (an idle session's, at its next prompt), without stopping anything. `from` is `'user'`, or a session id, which must be an ancestor of the
   * target: a session steers only its own sub-agents (and theirs). Throws otherwise.
   */
  send(params: { id: SessionId; content: string; from: InboxMessage['from'] }): void {
    const { id, content, from } = params;
    const session = this.#require(id);

    if (!isOpen(session.state)) {
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

    this.#emit({ type: 'session_message', session, message });
    this.#inboxes.add({ id, message });
  }

  /** Removes and returns the session's queued messages, oldest first. */
  takeMessages(id: SessionId): InboxMessage[] {
    return this.#inboxes.take(id);
  }

  hasMessages(id: SessionId): boolean {
    return this.#inboxes.has(id);
  }

  /** Resolves when a message arrives for the session (or it ends). For a loop waiting idle. */
  nextMessage(id: SessionId): Promise<void> {
    return this.#inboxes.next(id);
  }

  get(id: SessionId): SessionInfo | undefined {
    const session = this.#sessions.get(id);

    return session && { ...session };
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map((session) => ({ ...session }));
  }

  /** The sessions `id` started directly. */
  children(id: SessionId): SessionInfo[] {
    return this.list().filter((session) => session.parentId === id);
  }

  /** `id` and every ancestor, up to the main session (last). */
  lineage(id: SessionId): SessionInfo[] {
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
   * Adds an event of session `sessionId`'s loop to the combined stream, in the order published.
   * The loop publishes each event as it releases it, so a session's events keep their own order.
   */
  publish(params: { sessionId: SessionId; event: AgentEvent }): void {
    const { sessionId, event } = params;

    this.#require(sessionId);
    this.#entries.add((seq) => ({ seq, sessionId, kind: 'event', event }));
  }

  /**
   * Calls `listener` for the entries of the combined stream `filter` picks (every session's, one
   * session's, or a session's and its sub-agents'), sub-agents included, in one `seq` order;
   * with `replay`, from the run's start. Each entry is frozen. Returns a function that stops it.
   */
  subscribeEntries(listener: (entry: StreamEntry) => void, filter?: EntryFilter): () => void {
    return this.#entries.subscribe({ listener, ...(filter && { filter }) });
  }

  /**
   * Updates as server-sent events (`text/event-stream`), for an HTTP response body:
   * `new Response(sessions.stream({ signal }), { headers: { 'content-type': 'text/event-stream' } })`.
   * Starts with every known session (so a late UI catches up), then streams live until `signal`.
   */
  stream(params: { signal?: AbortSignal } = {}): ReadableStream<Uint8Array> {
    return updateStream({ sessions: this, ...params });
  }

  #add(params: SessionRef & { title: string }): SessionRef {
    const session: SessionInfo = { ...params, state: 'running', startedAt: Date.now() };

    this.#sessions.set(session.id, session);
    this.#emit({ type: 'session_started', session });

    const { id, parentId, rootId, depth } = session;

    return { id, ...(parentId !== undefined && { parentId }), rootId, depth };
  }

  #require(id: SessionId): SessionInfo {
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

    notifyAll({ listeners: this.#listeners, value: snapshot });
    this.#entries.add((seq) => ({ seq, sessionId: snapshot.session.id, kind: 'update', update }));
  }
}
