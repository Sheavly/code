import type { AgentEventBody } from '@sheavly/protocol/event/event.types';

/** What a tool call turns into once it returns. */
export type ToolOutcome = Extract<AgentEventBody, { type: 'tool_result' | 'task_running' }>;
