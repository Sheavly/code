import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage, PromptPart } from '@sheavly/protocol/message/message.types';
import type { Harness } from '../host/host.types.js';

/**
 * Runs one prompt of a conversation and yields its events. The UI passes the loop's
 * `streamAgent` here (the host doesn't depend on the loop).
 */
export type RunPrompt = (options: {
  provider: Provider;
  tools: Tool[];
  hooks: Hook[];
  messages: HistoryMessage[];
  signal: AbortSignal;
  tasks: TaskRegistry;
  session: RunSession;
  keepSession: true;
  /** Every prompt after the first: the session already ran its `sessionStart` hooks. */
  resumed: boolean;
  waitForTasks?: boolean;
  instructions?: string;
  maxTurns?: number;
  summary?: SummaryOptions;
}) => AsyncIterable<AgentEvent>;

/** What a conversation runs every prompt with: the UI's choices, as for a single run. */
export type ConversationOptions = {
  /** The shared services: its main session is the conversation's. */
  harness: Harness;
  run: RunPrompt;
  tools: Tool[];
  hooks?: Hook[];
  /** Complete override of harness instructions; an empty string intentionally omits them. */
  instructions?: string;
  maxTurns?: number;
  /** Also wait for ordinary background tasks. Required completions, such as sub-agents, always wait. */
  waitForTasks?: boolean;
  /** Summarize the history when the context nears the window; passed to every prompt's run. */
  summary?: SummaryOptions;
  /**
   * The history to continue from (default: none), e.g. a conversation saved earlier: its first
   * prompt runs on it, in this harness's new session.
   */
  messages?: HistoryMessage[];
  /**
   * Starts as a conversation whose session already ran: its first prompt resumes the main
   * session instead of starting it (a reopened conversation, whose `sessionStart` hooks already
   * added their context to `messages`).
   */
  resumed?: boolean;
  /**
   * Told the history whenever a prompt starts (with the user's message on it) and whenever one
   * ends or fails (the history as it is now). It must not throw or wait: a caller that keeps the
   * history somewhere queues the write and reports a failure its own way.
   */
  keepHistory?: (messages: readonly HistoryMessage[]) => void;
};

/**
 * One conversation the user keeps talking to: each prompt continues from the history so far, in
 * the same session, which is idle between prompts and ends only on `close`.
 */
export type Conversation = {
  /**
   * Runs `prompt` as the next turn of the conversation and yields its events; iterate it to the
   * end (or abort `signal`, or stop iterating, to stop the prompt). Throws a `SessionError`
   * (`session_running`) while another prompt runs, and (`session_ended`) once closed. `parts`
   * is what the user typed, when skills ran: it goes on the history's user message for a UI.
   */
  send: (
    prompt: string,
    options?: { signal?: AbortSignal; parts?: PromptPart[] | undefined },
  ) => AsyncIterable<AgentEvent>;
  /** The history so far: every finished prompt's, valid to continue from. */
  readonly messages: readonly HistoryMessage[];
  /** Whether a prompt is running now. */
  readonly running: boolean;
  /**
   * Ends this live conversation: stops the running prompt, cancels its background tasks (and the
   * processes they run) and ends the session. Idempotent. It deletes nothing: `messages` stays
   * readable, and a new conversation can continue from it (`options.messages`).
   */
  close: () => Promise<void>;
};
