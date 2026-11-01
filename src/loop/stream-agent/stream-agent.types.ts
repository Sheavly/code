import type { Message } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { TaskRegistry } from '../../runtime/tasks/tasks.service.js';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type {
  AgentEvent,
  AgentEventBody,
  DescribedCall,
  ToolOutcome,
} from '../events/events.types.js';
import type { OrderedQueue } from '../queue/queue.service.js';
import type { RunSession } from '../../runtime/sessions/sessions.types.js';
import type { SessionRef } from '@sheavly/core/session/session.types';

export type AgentOptions = {
  provider: Provider;
  tools: Tool[];
  messages: Message[];
  maxTurns?: number;
  /** The host's system instructions, sent with every model call (hooks may add more). */
  instructions?: string;
  signal?: AbortSignal;
  /** Background tasks. Finished ones are reported to the model at the start of each turn. */
  tasks?: TaskRegistry;
  /**
   * When the model is done but background tasks are still running, wait for the next one to
   * finish and give the model another turn (instead of ending the run). Abort to stop waiting.
   */
  waitForTasks?: boolean;
  /**
   * Customize the loop: add context before turns, wrap tool calls. Run in this order. A sub-agent
   * gets only the hooks its parent passes it.
   */
  hooks?: Hook[];
  /**
   * Which session this run is (from a `SessionRegistry`). Omit it and the run starts its own
   * main session with a fresh id. Either way the session is ended with the run's outcome.
   */
  session?: RunSession;
};

export type RunAgentOptions = AgentOptions & { onEvent?: (event: AgentEvent) => void };

/** The queue every loop event goes through, in causal order. */
export type AgentEvents = OrderedQueue<AgentEventBody>;

/** What one run shares with each of its turns. */
export type RunContext = {
  options: AgentOptions;
  /** The run's session: the one passed in, or a main session it started itself. */
  session: RunSession;
  signal: AbortSignal;
  /** Resolves when `signal` aborts. */
  aborted: Promise<void>;
  events: AgentEvents;
};

export type TurnContext = RunContext & {
  turn: number;
  /** The run's history; the turn appends to it. */
  messages: Message[];
};

/** A tool call that started while the model streamed, with its eventual outcome. */
export type RunningCall = {
  described: DescribedCall;
  outcome: Promise<ToolOutcome>;
};

/** What a tool needs to start: the tools, hooks, task registry and the run's abort state. */
export type ToolStart = {
  tools: Tool[];
  hooks?: Hook[] | undefined;
  tasks?: TaskRegistry | undefined;
  /** The run's session, passed on to tools (`context.session`). */
  session: SessionRef;
  signal: AbortSignal;
  aborted: Promise<void>;
};

export type SampleContext = ToolStart & {
  provider: Provider;
  /** This turn's system instructions: the run's own plus what `beforeTurn` hooks added. */
  instructions?: string | undefined;
  messages: Message[];
  events: AgentEvents;
};
