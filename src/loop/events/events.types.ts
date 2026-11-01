import type { Sequenced } from '../queue/queue.types.js';
import type { TaskInfo } from '../../runtime/tasks/tasks.types.js';
import type { FileChange, FileRead } from '@sheavly/core/tool/tool.types';
import type { InboxMessage, SessionRef } from '@sheavly/core/session/session.types';
import type {
  Message,
  ReasoningItem,
  TurnStopReason,
  ToolCall,
} from '@sheavly/core/message/message.types';

export type DescribedCall = {
  call: ToolCall;
  /** The model's plain-language note, e.g. "reading index.ts". */
  description: string;
};

/**
 * One step the loop took. Per turn, in causal order:
 *
 *   task_completed × N                            (background tasks that finished since last turn)
 *   → message_received × N                        (messages sent to this session meanwhile)
 *   → context_added × N                           (hooks' `beforeTurn` context, in hook order)
 *   → text_delta / reasoning / tool_call_started  (live, as the model streams)
 *   → turn_end
 *   → tool_batch → tool_result | task_running × N (results in call order)
 *   → next turn ... → done
 */
export type AgentEventBody =
  | { type: 'text_delta'; text: string }
  /** Opaque reasoning state; kept in history and resent automatically. */
  | { type: 'reasoning'; item: ReasoningItem }
  /** The model asked for a tool and it started running (concurrently with the rest of the turn). */
  | ({ type: 'tool_call_started' } & DescribedCall)
  | { type: 'turn_end'; turn: number; stopReason: TurnStopReason }
  /** The turn ended with these calls; their results follow in this order. */
  | { type: 'tool_batch'; calls: DescribedCall[] }
  /**
   * A tool's result, released only after the turn ended and all earlier results were. `change`:
   * the file a tool created or edited (path, before, after), for a UI to render as a diff.
   */
  | ({
      type: 'tool_result';
      message: Message;
      durationMs: number;
      change?: FileChange;
      /** What a read covered (path, lines, whole file or not), for a UI to show. */
      read?: FileRead;
    } & DescribedCall)
  /** In place of `tool_result` when the call launched a background task: it's still running. */
  | ({ type: 'task_running'; task: TaskInfo; message: Message; durationMs: number } & DescribedCall)
  /** A background task finished (or failed); the model is told at the start of the next turn. */
  | { type: 'task_completed'; task: TaskInfo }
  /**
   * A message sent to this session while it worked (user steering, or from the session that
   * started it), added to history before this turn's model call.
   */
  | { type: 'message_received'; message: InboxMessage }
  /** A hook's `beforeTurn` added this context to history; the model sees it from this turn on. */
  | { type: 'context_added'; hook: string; content: string }
  /**
   * A hook handler failed where it must not stop the run (`onError`). The run's own error is
   * still what ends the stream; this says the hook couldn't do its job.
   */
  | { type: 'hook_failed'; hook: string; handler: string; error: string }
  /** Always last. The full conversation (valid to continue from, even after an interrupt). */
  | { type: 'done'; reason: DoneReason; messages: Message[]; session: SessionRef };

export type DoneReason = 'completed' | 'interrupted' | 'max_turns';

/** Every event carries `seq`: 0, 1, 2, ... with no gaps, in the order consumers receive them. */
export type AgentEvent = Sequenced<AgentEventBody>;

/** What a tool call turns into once it returns. */
export type ToolOutcome = Extract<AgentEventBody, { type: 'tool_result' | 'task_running' }>;
