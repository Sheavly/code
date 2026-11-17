import type { OutputStore } from '@sheavly/core/output/output.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { HostService } from '@sheavly/extension/extension/extension.types';
import { defineService, hostService } from '@sheavly/extension/extension/extension.utils';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import type { Harness } from '../host/host.types.js';
import type { ApprovalRequester } from './run-services.types.js';

/** The provider the run's main session talks to. */
export const PROVIDER = defineService<Provider>('provider');

/** The composed base instructions (`Harness.instructions`), the guidance sub-agents start from. */
export const INSTRUCTIONS = defineService<string>('instructions');

/** The run's session registry: every session, main and sub-agents. */
export const SESSIONS = defineService<SessionRegistry>('sessions');

/** The main session of the run. */
export const MAIN_SESSION = defineService<SessionRef>('main-session');

/** The run's one task registry, where background work starts and is observed. */
export const TASKS = defineService<TaskRegistry>('tasks');

/**
 * Where a tool asks the user to approve something. It only requests: answering belongs to the UI
 * and the app, never to an extension, so the value has no `respond`, `subscribe` or `pending`.
 */
export const APPROVALS = defineService<ApprovalRequester>('approvals');

/** The conversation's complete command output store. Provided only when the app has one: read it with `find`. */
export const OUTPUTS = defineService<OutputStore>('outputs');

/**
 * The run services as `ExtensionHostOptions.services`, for every extension to read without a
 * dependency. The values are the harness's own objects, not copies, except `APPROVALS`, which is
 * a request-only view of the registry; `OUTPUTS` is left out when the app has no output store.
 * They are not a sandbox: an extension that reads one acts with the run's authority, so an app
 * filters this list for extensions it trusts less.
 */
export function runServices(params: {
  harness: Harness;
  outputs?: OutputStore | undefined;
}): HostService[] {
  const { harness, outputs } = params;
  const approvals: ApprovalRequester = {
    request: (request) => harness.approvals.request(request),
  };

  return [
    hostService({ key: PROVIDER, value: harness.provider }),
    hostService({ key: INSTRUCTIONS, value: harness.instructions }),
    hostService({ key: SESSIONS, value: harness.sessions }),
    hostService({ key: MAIN_SESSION, value: harness.mainSession }),
    hostService({ key: TASKS, value: harness.tasks }),
    hostService({ key: APPROVALS, value: approvals }),
    ...(outputs ? [hostService({ key: OUTPUTS, value: outputs })] : []),
  ];
}
