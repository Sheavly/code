import type { Hook } from '@sheavly/core/hook/hook.types';
import type { Message } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { SessionRegistry } from '../../runtime/sessions/sessions.service.js';
import type { RunSession } from '../../runtime/sessions/sessions.types.js';
import type { TaskRegistry } from '../../runtime/tasks/tasks.service.js';

/**
 * Runs one nested agent loop to its end. The host passes the loop's `runSession` here (tools
 * can't import the loop, so it comes in as an option).
 */
export type RunNestedAgent = (options: {
  provider: Provider;
  tools: Tool[];
  hooks: Hook[];
  instructions: string;
  messages: Message[];
  signal: AbortSignal;
  tasks: TaskRegistry;
  waitForTasks: boolean;
  session: RunSession;
  maxTurns?: number;
}) => Promise<{ reason: string; messages: Message[] }>;

/** What a parent decides about the sub-agents it starts (and passes on to theirs). */
export type SubAgentOptions = {
  /** The registry the parent's session is in; sub-agents are added to it, linked to the parent. */
  sessions: SessionRegistry;
  /** The parent's background tasks: each sub-agent runs as one, so the parent can wait or cancel. */
  tasks: TaskRegistry;
  provider: Provider;
  /** Runs a sub-agent's loop: the loop's `runSession`. */
  runAgent: RunNestedAgent;
  /** The tools sub-agents get. `report_status` (and `start_agent`, below the depth cap) are added. */
  tools: Tool[];
  /** The hooks sub-agents get; the parent's own hooks are not inherited unless listed here. */
  hooks?: Hook[];
  /** Extra system instructions for sub-agents, after the built-in sub-agent rules. */
  instructions?: string;
  maxTurns?: number;
};
