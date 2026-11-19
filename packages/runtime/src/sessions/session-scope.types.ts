import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { ModelEffort, ModelId } from '@sheavly/protocol/model/model.types';
import type {
  InboxMessage,
  SessionId,
  SessionInfo,
  SessionRef,
  SessionUpdate,
} from '@sheavly/protocol/session/session.types';

/** The updates `SessionInfoView.onLifecycle` delivers: a session's state changes, never a message. */
export type SessionLifecycleUpdate = Extract<
  SessionUpdate,
  {
    type:
      'session_started' | 'session_idle' | 'session_resumed' | 'session_ended' | 'session_released';
  }
>;

/**
 * Read-only metadata of every session of the run, for the `session:read` grant. It carries no
 * message content, no inbox, no way to change a session and no `RunSession`.
 */
export type SessionInfoView = {
  get(id: SessionId): SessionInfo | undefined;
  list(): SessionInfo[];
  /** Whether `id` was a session of the run that has since been released. */
  isReleased(id: SessionId): boolean;
  /** The sessions released so far and when each started: their history stays readable. */
  releasedStarts(): { id: SessionId; startedAt: number }[];
  /** Calls `listener` for every lifecycle update from now on; returns a function that stops it. */
  onLifecycle(listener: (update: SessionLifecycleUpdate) => void): () => void;
};

/** What `ChildSessionScope.runChild` runs: one nested agent loop, to its end. */
export type RunChildParams = {
  /** A child this scope started (`startChild`): the scope refuses any other session. */
  child: SessionRef;
  provider: Provider;
  tools: Tool[];
  hooks: Hook[];
  instructions: string;
  messages: HistoryMessage[];
  signal: AbortSignal;
  summary?: SummaryOptions;
  /** Told with the history so far, whole, before the run and again when it ends. */
  keepHistory?: (messages: readonly HistoryMessage[]) => void;
  /**
   * Called once the loop has returned or failed, before the child's tasks are cancelled: stop
   * listening to the child here, and the updates that cancelling produces are not delivered.
   */
  onRunEnd?: () => void;
};

/** How a nested loop ended (`reason`, `completed` when it finished) and its whole history. */
export type RunChildResult = { reason: string; messages: HistoryMessage[] };

/**
 * The sub-agent sessions one extension owns, checked against `sub-agent:create` (`startChild`,
 * `setModel`, `runChild`), `sub-agent:message` (`send`), `sub-agent:observe` (`onUpdate`) and
 * `sub-agent:report` (`report`). Every `id` must be a child this scope started, and the parent of
 * a new child the main session or an owned child. It never exposes the registry, the loop's
 * `RunSession`, `end`, `idle`, `resume`, `release` or the inboxes. `runChild` owns the plumbing
 * into the loop: it passes the full registries to it and cancels the child's tasks when it ends.
 */
export type ChildSessionScope = {
  /** Throws for an unknown or ended parent, the depth cap and a `startedByCall` a sibling used. */
  startChild(params: { parentId: SessionId; startedByCall: CallId; title: string }): SessionRef;
  setModel(params: { id: SessionId; modelId: ModelId; effort?: ModelEffort }): void;
  /** `from` is the main session or an owned child, never `'user'`. */
  send(params: {
    id: SessionId;
    content: string;
    from: Exclude<InboxMessage['from'], 'user'>;
  }): void;
  report(params: { id: SessionId; status: string }): void;
  /** Calls `listener` for every update of an owned child; returns a function that stops it. */
  onUpdate(listener: (update: SessionUpdate) => void): () => void;
  runChild(params: RunChildParams): Promise<RunChildResult>;
};
