import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { Harness } from '../host/host.types.js';

/**
 * Runs one prompt of a conversation and yields its events. The UI passes the loop's
 * `streamAgent` here (the host doesn't depend on the loop).
 */
export type RunPrompt = (options: {
  provider: Provider;
  tools: Tool[];
  hooks: Hook[];
  messages: Message[];
  signal: AbortSignal;
  tasks: TaskRegistry;
  session: RunSession;
  keepSession: true;
  /** Every prompt after the first: the session already ran its `sessionStart` hooks. */
  resumed: boolean;
  waitForTasks?: boolean;
  instructions?: string;
  maxTurns?: number;
}) => AsyncIterable<AgentEvent>;

/** What a conversation runs every prompt with: the UI's choices, as for a single run. */
export type ConversationOptions = {
  /** The shared services: its main session is the conversation's. */
  harness: Harness;
  run: RunPrompt;
  tools: Tool[];
  hooks?: Hook[];
  instructions?: string;
  maxTurns?: number;
  /** Wait for background tasks before a prompt's run ends (default: no, they're reported next). */
  waitForTasks?: boolean;
  /**
   * The history to continue from (default: none), e.g. a conversation saved earlier: its first
   * prompt runs on it, in this harness's new session.
   */
  messages?: Message[];
};

/**
 * One conversation the user keeps talking to: each prompt continues from the history so far, in
 * the same session, which is idle between prompts and ends only on `close`.
 */
export type Conversation = {
  /**
   * Runs `prompt` as the next turn of the conversation and yields its events; iterate it to the
   * end (or abort `signal`, or stop iterating, to stop the prompt). Throws a `SessionError`
   * (`session_running`) while another prompt runs, and (`session_ended`) once closed.
   */
  send: (prompt: string, options?: { signal?: AbortSignal }) => AsyncIterable<AgentEvent>;
  /** The history so far: every finished prompt's, valid to continue from. */
  readonly messages: readonly Message[];
  /** Whether a prompt is running now. */
  readonly running: boolean;
  /**
   * Ends this live conversation: stops the running prompt, cancels its background tasks (and the
   * processes they run) and ends the session. Idempotent. It deletes nothing: `messages` stays
   * readable, and a new conversation can continue from it (`options.messages`).
   */
  close: () => Promise<void>;
};
