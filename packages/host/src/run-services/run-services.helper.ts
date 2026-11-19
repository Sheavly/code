import type { OutputStore } from '@sheavly/core/output/output.types';
import type { HostService } from '@sheavly/extension/extension/extension.types';
import { hostService } from '@sheavly/extension/extension/extension.utils';
import type { Harness } from '../host/host.types.js';
import { ApprovalsScope } from './approvals.service.js';
import { BackgroundTasksScope } from './background-tasks.service.js';
import { ChildSessionsScope } from './child-sessions.service.js';
import { ModelScope } from './model.service.js';
import { OutputCaptureScope, OutputReaderScope } from './output-scopes.service.js';
import {
  APPROVALS_GRANTS,
  BACKGROUND_TASKS_GRANTS,
  CHILD_SESSIONS_GRANTS,
  MODEL_GRANTS,
  OUTPUT_CAPTURE_GRANTS,
  OUTPUT_READER_GRANTS,
  SESSION_INFO_GRANTS,
  TASK_CONTROL_GRANTS,
} from './run-services.constants.js';
import type { RunLoop } from './run-services.types.js';
import {
  APPROVALS,
  BACKGROUND_TASKS,
  CHILD_SESSIONS,
  INSTRUCTIONS,
  MAIN_SESSION,
  MODEL,
  OUTPUT_CAPTURE,
  OUTPUT_READER,
  SESSION_INFO,
  TASK_CONTROL,
} from './run-services.utils.js';
import { scopedService } from './scoped-service.helper.js';
import { SessionInfoScope } from './session-info.service.js';
import { TaskControlScope } from './task-control.service.js';

/**
 * The run services as `ExtensionHostOptions.services`, for every extension to read without a
 * dependency. Every one that can act on the run is built per extension and checks the grants its
 * manifest declares: `SESSION_INFO`, `CHILD_SESSIONS`, `BACKGROUND_TASKS`, `TASK_CONTROL`,
 * `OUTPUT_READER`, `OUTPUT_CAPTURE`, `MODEL` and `APPROVALS`. The output pair reads as not
 * provided (`find` answers `undefined`) when the app has no output store, though its grants stay
 * known. `INSTRUCTIONS` (a read-only view that composes the prompt at each read) and
 * `MAIN_SESSION` need no grant. `runSession` is the
 * loop's runner, which `CHILD_SESSIONS` calls itself so no extension holds the loop or a registry.
 * Grants limit what a service does for an extension; they are not a sandbox, and an app filters
 * this list for extensions it trusts less.
 */
export function runServices(params: {
  harness: Harness;
  outputs?: OutputStore | undefined;
  runSession: RunLoop;
}): HostService[] {
  const { harness, outputs, runSession } = params;
  const { sessions, tasks, mainSession, approvals } = harness;

  return [
    scopedService({
      key: SESSION_INFO,
      grants: SESSION_INFO_GRANTS,
      build: (guard) => new SessionInfoScope({ guard, sessions }),
    }),
    scopedService({
      key: CHILD_SESSIONS,
      grants: CHILD_SESSIONS_GRANTS,
      build: (guard) =>
        new ChildSessionsScope({
          guard,
          registry: sessions,
          tasks,
          main: mainSession,
          runLoop: runSession,
        }),
    }),
    scopedService({
      key: BACKGROUND_TASKS,
      grants: BACKGROUND_TASKS_GRANTS,
      build: (guard) => new BackgroundTasksScope({ guard, registry: tasks, sessions }),
    }),
    scopedService({
      key: TASK_CONTROL,
      grants: TASK_CONTROL_GRANTS,
      build: (guard) => new TaskControlScope({ guard, tasks }),
    }),
    scopedService({
      key: MODEL,
      grants: MODEL_GRANTS,
      build: (guard) => new ModelScope({ guard, provider: harness.provider }),
    }),
    scopedService({
      key: APPROVALS,
      grants: APPROVALS_GRANTS,
      build: (guard) => new ApprovalsScope({ guard, registry: approvals, sessions }),
    }),
    // Without a store these read as not provided (`find` answers undefined), but stay supplied so
    // a manifest that asks for their grants still activates.
    scopedService({
      key: OUTPUT_READER,
      grants: OUTPUT_READER_GRANTS,
      build: (guard) => outputs && new OutputReaderScope({ guard, store: outputs }),
    }),
    scopedService({
      key: OUTPUT_CAPTURE,
      grants: OUTPUT_CAPTURE_GRANTS,
      build: (guard) => outputs && new OutputCaptureScope({ guard, store: outputs }),
    }),
    // A read-only view: the harness keeps the object that takes contributions.
    hostService({
      key: INSTRUCTIONS,
      value: Object.freeze({
        get text() {
          return harness.systemPrompt.text;
        },
      }),
    }),
    // A frozen copy: the harness keeps its own object, which no extension can reach to change.
    hostService({ key: MAIN_SESSION, value: Object.freeze({ ...mainSession }) }),
  ];
}
