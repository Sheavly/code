import type { SessionId } from '@sheavly/protocol/session/session.types';
import { ToolCallError } from '../errors/tool.errors.js';
import type { ToolContext } from './tool.types.js';

/**
 * The calling session's id. The run's tasks share one registry and a session sees only its own,
 * so a call with no session would see them all: it is refused, as `start_agent` refuses one. The
 * task tools and the background command tools all read their owner through it.
 */
export function requireTaskSession(params: { context: ToolContext; tool: string }): SessionId {
  const { context, tool } = params;

  if (!context.session) {
    throw new ToolCallError({
      reason: 'unavailable',
      message: `${tool} only works inside an agent session`,
    });
  }

  return context.session.id;
}
