import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { ChildSessionScope } from '@sheavly/runtime/sessions/session-scope.types';
import type { TaskControl, TaskStarter } from '@sheavly/runtime/tasks/task-scope.types';
import type { SessionLookup } from './message-agent.types.js';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ModelSelection } from '@sheavly/protocol/model/model.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/**
 * What the sub-agent tool starts, runs and steers through, as scopes an extension holds:
 * `children` starts, runs and observes the sub-agents the extension owns, `tasks` starts their
 * work, `taskControl` is what their task tools act through, and `sessions` looks sessions up.
 */
export type SubAgentScopes = {
  sessions: SessionLookup;
  children: ChildSessionScope;
  tasks: TaskStarter;
  taskControl: TaskControl;
};

/** What a parent decides about the sub-agents it starts (and passes on to theirs). */
export type SubAgentOptions = {
  /** What the sub-agents are started, run and steered through; passed on to theirs. */
  scopes: SubAgentScopes;
  provider: Provider;
  /** Captures the parent's model and effort when starting; descendants keep that snapshot. */
  selectProvider?: () => { provider: Provider; selection?: ModelSelection };
  /** The tools sub-agents get. `report_status` (and `start_agent`, below the depth cap) are added. */
  tools: Tool[];
  /**
   * Whether `tools` start background work (a command), so a sub-agent also gets the task tools
   * where it could not start sub-agents of its own (at the depth cap) and can inspect and cancel
   * what it starts. What it starts is owned by its session, so it cancels only that. Below the cap
   * it has the task tools anyway. Read when each sub-agent starts, so a list or a flag that fills
   * in after this is built still applies.
   */
  withTaskTools?: boolean;
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
