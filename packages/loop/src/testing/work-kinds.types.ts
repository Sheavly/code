import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Tool } from '@sheavly/core/tool/tool.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';

/** How a piece of work ends: soon and well, soon and badly, or not before something stops it. */
export type WorkSpeed = 'quick' | 'slow' | 'failing';

export type WorkEnv = { tasks: TaskRegistry; sessions: SessionRegistry };

/**
 * One kind of work a model can start. The flow suites run every entry through the same
 * assertions, so a kind added to the harness is one entry in the table.
 */
export type WorkKind = {
  name: string;
  /** Runs as a task of the calling session; a foreground tool does not. */
  background: boolean;
  /** Finite work can be awaited and holds its session; a service does neither. */
  finite: boolean;
  tools(env: WorkEnv): Tool[];
  /** The model turn that starts one piece of work. `id` names the call. */
  start(params: { speed: WorkSpeed; id: string }): StreamEvent[];
};
