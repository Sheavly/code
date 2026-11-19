import type { OutputCapture, OutputReader } from '@sheavly/core/output/output.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import type {
  ChildSessionScope,
  SessionInfoView,
} from '@sheavly/runtime/sessions/session-scope.types';
import type { BackgroundTaskScope, TaskControl } from '@sheavly/runtime/tasks/task-scope.types';
import { defineService } from '../extension/extension.utils.js';
import type { ApprovalRequester, SystemPromptView } from './run-services.types.js';

/**
 * The run's system prompt (`Harness.instructions`), the guidance sub-agents start from. Read
 * `text` at use, not once in `activate`: the extensions' contributions appear only after every
 * extension has activated, so during an `activate` it is the base plus the app's own instructions,
 * and a read made later (an agent's read when it starts a sub-agent) sees them.
 */
export const INSTRUCTIONS = defineService<SystemPromptView>('instructions');

/** The main session of the run. */
export const MAIN_SESSION = defineService<SessionRef>('main-session');

/**
 * Where a tool asks the user to approve something, and whether anyone is there to answer. It only
 * requests: answering belongs to the UI and the app, never to an extension. Grant `approval:request`.
 */
export const APPROVALS = defineService<ApprovalRequester>('approvals');

/** What sessions look like to an extension: read-only metadata, no message content. Grant `session:read`. */
export const SESSION_INFO = defineService<SessionInfoView>('session-info');

/** The sub-agents an extension started, and only those. Grants `sub-agent:create|message|observe|report`. */
export const CHILD_SESSIONS = defineService<ChildSessionScope>('child-sessions');

/** The background tasks an extension started, and only those. Grants `task:start|read|cancel`. */
export const BACKGROUND_TASKS = defineService<BackgroundTaskScope>('background-tasks');

/** Reading and cancelling any task of a given session, whatever started it. Grants `task:read-any|cancel-any`. */
export const TASK_CONTROL = defineService<TaskControl>('task-control');

/** Reading the complete command output. Provided only when the app has an output store. Grant `output:read`. */
export const OUTPUT_READER = defineService<OutputReader>('output-reader');

/** Creating a command output capture. Provided only when the app has an output store. Grant `output:capture`. */
export const OUTPUT_CAPTURE = defineService<OutputCapture>('output-capture');

/** The run's provider for model calls on the app's credentials. Grant `model:call`. */
export const MODEL = defineService<Provider>('model');
