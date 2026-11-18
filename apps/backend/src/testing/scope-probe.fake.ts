import { z } from 'zod';
import type { ExtensionEmit } from '@sheavly/extension/emit/emit.types';
import type { ExtensionOrigin } from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import {
  APPROVALS,
  BACKGROUND_TASKS,
  CHILD_SESSIONS,
  MAIN_SESSION,
  MODEL,
  OUTPUT_CAPTURE,
  OUTPUT_READER,
  SESSION_INFO,
  TASK_CONTROL,
} from '@sheavly/host/run-services/run-services.utils';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { finiteWork } from '@sheavly/runtime/tasks/work.utils';
import { manifestOf } from './manifest.fake.js';
import { ALL_GRANTS } from './testing.constants.js';
import type { ProbeScopes } from './testing.types.js';

const progress = z.object({ done: z.number() });

/**
 * Test-only: an extension that reads every scoped run service, holds them for the test, and
 * declares exactly the `grants` given. What a probe is does not depend on `origin`: a built-in
 * and a third-party probe declare the same manifest, so a test runs the same assertions for both.
 * With `emits` it declares and contributes one event and one notice, named after the probe.
 */
export function scopeProbe(params: {
  name: string;
  origin?: ExtensionOrigin | undefined;
  grants?: string[];
  emits?: boolean | undefined;
}) {
  const { name, origin, grants = ALL_GRANTS, emits = false } = params;
  const kind = `${name}.wait`;
  const eventKind = `${name}.progress`;
  const topic = `${name}.reminder`;
  let held: { scopes: ProbeScopes; emit: ExtensionEmit } | undefined;
  const extension = defineExtension({
    origin,
    manifest: manifestOf({
      name,
      grants,
      workKinds: [kind],
      emits: emits ? { events: [eventKind], modelFacingNotices: true } : {},
      services: {
        requires: [
          SESSION_INFO.name,
          CHILD_SESSIONS.name,
          BACKGROUND_TASKS.name,
          TASK_CONTROL.name,
          APPROVALS.name,
          MODEL.name,
          MAIN_SESSION.name,
        ],
        optional: [OUTPUT_READER.name, OUTPUT_CAPTURE.name],
      },
    }),
    activate: ({ services, emit }) => {
      held = {
        emit,
        scopes: {
          info: services.get(SESSION_INFO),
          child: services.get(CHILD_SESSIONS),
          tasks: services.get(BACKGROUND_TASKS),
          control: services.get(TASK_CONTROL),
          approvals: services.get(APPROVALS),
          model: services.get(MODEL),
          main: services.get(MAIN_SESSION),
          reader: services.find(OUTPUT_READER),
          capture: services.find(OUTPUT_CAPTURE),
        },
      };

      return {
        workKinds: [{ name: kind, description: 'Waits to be cancelled', completion: 'finite' }],
        ...(emits && {
          events: [{ kind: eventKind, version: 1, schema: progress }],
          notices: [{ topic, version: 1, schema: progress }],
        }),
      };
    },
  });

  const probe = () => {
    if (!held) throw new Error(`${name} has not activated`);

    return held;
  };

  return {
    extension,
    eventKind,
    topic,
    scopes: () => probe().scopes,
    emit: () => probe().emit,
    /** Starts work for `sessionId` through this probe's own `BackgroundTaskScope`, until cancelled. */
    startWaiting: (sessionId: SessionId) =>
      probe().scopes.tasks.start(
        finiteWork({
          command: kind,
          description: 'waits',
          sessionId,
          run: ({ signal }) =>
            new Promise((resolve) =>
              signal.addEventListener('abort', () => resolve({ exitCode: 1 })),
            ),
        }),
      ),
  };
}
