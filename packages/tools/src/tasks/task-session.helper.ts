import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskId } from '@sheavly/protocol/task/task.types';

/**
 * The calling session's id. The run's tasks share one registry and a session sees only its own,
 * so a call with no session would see them all: it is refused, as `start_agent` refuses one.
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

/**
 * Said for a task id the caller has no task for: one that never existed, one another session
 * owns, or one already reported and released. The three read alike, so an id reveals nothing
 * about another session's tasks.
 */
export function missingTaskMessage(id: TaskId): string {
  return `No task with id ${id}: it does not exist, or it was already reported and released`;
}
