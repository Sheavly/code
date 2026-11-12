import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ModelSelection } from '@sheavly/protocol/model/model.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/**
 * Runs one nested agent loop to its end. The host passes the loop's `runSession` here (tools
 * can't import the loop, so it comes in as an option).
 */
export type RunNestedAgent = (options: {
  provider: Provider;
  tools: Tool[];
  hooks: Hook[];
  instructions: string;
  messages: HistoryMessage[];
  signal: AbortSignal;
  tasks: TaskRegistry;
  session: RunSession;
  summary?: SummaryOptions;
}) => Promise<{ reason: string; messages: HistoryMessage[] }>;

/** What a parent decides about the sub-agents it starts (and passes on to theirs). */
export type SubAgentOptions = {
  /** The registry the parent's session is in; sub-agents are added to it, linked to the parent. */
  sessions: SessionRegistry;
  /** The parent's background tasks: each sub-agent runs as one, so the parent can wait or cancel. */
  tasks: TaskRegistry;
  provider: Provider;
  /** Captures the parent's model and effort when starting; descendants keep that snapshot. */
  selectProvider?: () => { provider: Provider; selection?: ModelSelection };
  /** Runs a sub-agent's loop: the loop's `runSession`. */
  runAgent: RunNestedAgent;
  /** The tools sub-agents get. `report_status` (and `start_agent`, below the depth cap) are added. */
  tools: Tool[];
  /**
   * Tools that start background tasks (e.g. `run_command`), built for each sub-agent on its own
   * task registry so the sub-agent waits for and can cancel what it starts.
   */
  tasksTools?: (tasks: TaskRegistry) => Tool[];
  /** The hooks sub-agents get; the parent's own hooks are not inherited unless listed here. */
  hooks?: Hook[];
  /** Shared guidance before the child role. The host chooses it; parent history is not copied. */
  baseInstructions?: string;
  /** Extra system instructions for sub-agents, after the built-in sub-agent rules. */
  instructions?: string;
  /**
   * Summarize each sub-agent's history when its context nears the window, so a long-running one
   * keeps going. Called with the provider the sub-agent runs on (the model it was pinned to when
   * it started), so its summary is written, priced and logged by that model and never by one the
   * user switched to since. Passed on to the sub-agents it starts; none means no summaries.
   */
  summarizeWith?: (provider: Provider) => SummaryOptions;
  /**
   * Keeps a sub-agent's history durably: told with the history so far, whole, before the run (so a
   * crash does not lose the task) and again with the full history when the run ends. Each call
   * holds every entry so far, so the receiver appends only what is new. Passed on to the
   * sub-agents it starts; none keeps nothing.
   */
  keepHistory?: (params: { session: SessionId; messages: readonly HistoryMessage[] }) => void;
};
