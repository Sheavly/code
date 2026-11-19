/**
 * What `grants` in a `sheavly.json` does on the backend run: a method without its grant throws,
 * a grant nothing offers (or whose service is not read) fails the extension, a manifest that
 * still reads a removed service is skipped, and a scope stops working when the extension is
 * deactivated. Every test runs for a built-in and a third-party probe with the same manifest.
 */
import { describe, expect, it } from 'vitest';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import {
  BACKGROUND_TASKS,
  OUTPUT_READER,
} from '@sheavly/extension/run-services/run-services.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { manifestOf } from '../../testing/manifest.fake.js';
import { scopeProbe } from '../../testing/scope-probe.fake.js';
import { ALL_GRANTS, PROBE_KINDS } from '../../testing/testing.constants.js';

const open = useBackendRuns();
// A placeholder argument: a guarded method refuses before it reads it.
const noRequest = JSON.parse('{}') as never;

/** One call of every guarded scope method, by the grant it needs, for a probe in a run. */
function guardedCalls(params: { probe: ReturnType<typeof scopeProbe>; main: SessionId }) {
  const { probe, main: id } = params;
  const { info, child, tasks, control, approvals, model, reader, capture } = probe.scopes();

  return [
    ['session:read', () => info.get(id)],
    [
      'sub-agent:create',
      () => child.startChild({ parentId: id, startedByCall: callIdSchema.parse('c'), title: 't' }),
    ],
    ['sub-agent:message', () => child.send({ id, content: 'x', from: id })],
    ['sub-agent:observe', () => child.onUpdate(() => undefined)],
    ['sub-agent:report', () => child.report({ id, status: 'x' })],
    ['task:start', () => probe.startWaiting(id)],
    ['task:read', () => tasks.list()],
    ['task:cancel', () => tasks.cancel('x' as never)],
    ['task:read-any', () => control.list(id)],
    ['task:cancel-any', () => control.cancel({ id: 'x' as never, sessionId: id })],
    ['model:call', () => model.stream(noRequest)],
    ['output:read', () => reader?.read(noRequest)],
    ['output:capture', () => capture?.create()],
    ['approval:request', () => approvals.request(noRequest)],
    ['approval:request', () => approvals.listening],
  ] as const;
}

/** The rejection of `call`, whether it throws at once or rejects later: both read the same. */
const outcomeOf = async (call: () => unknown) => Promise.resolve().then(call);

describe.each(PROBE_KINDS)('$label extension', ({ origin }) => {
  const openProbe = async (grants: string[]) => {
    const probe = scopeProbe({ name: 'probe', origin, grants });
    const harness = await open({ extensions: [probe.extension], outputs: new MemoryOutputStore() });

    return { probe, harness, main: harness.mainSession.id };
  };

  it('throws the undeclared error, naming it and the grant, from every method without its grant', async () => {
    const { probe, main } = await openProbe([]);

    for (const [grant, call] of guardedCalls({ probe, main })) {
      await expect(outcomeOf(call), grant).rejects.toMatchObject({
        name: 'ExtensionUndeclaredError',
        extension: 'probe',
        use: 'grant',
        undeclared: grant,
      });
    }
  });

  it('lets the method of the grant it holds through, and refuses its siblings', async () => {
    const { probe, main } = await openProbe(['session:read']);
    const { info, child } = probe.scopes();

    expect(info.get(main)?.id).toBe(main);
    expect(() => child.report({ id: main, status: 'x' })).toThrow(/sub-agent:report/);
  });

  it('fails the activation of an extension that declares a grant no service offers, naming both', async () => {
    const typo = scopeProbe({ name: 'typo', origin, grants: ['sub-agent:teleport'] });

    await expect(open({ extensions: [typo.extension] })).rejects.toMatchObject({
      name: 'ExtensionGrantError',
      extension: 'typo',
      grant: 'sub-agent:teleport',
    });
  });

  it('fails the activation of an extension that declares a grant of a service it does not read', async () => {
    const lonely = defineExtension({
      origin,
      manifest: manifestOf({
        name: 'lonely',
        grants: ['task:cancel-any'],
        services: { requires: [BACKGROUND_TASKS.name] },
      }),
      activate: () => ({}),
    });

    await expect(open({ extensions: [lonely] })).rejects.toMatchObject({
      name: 'ExtensionGrantError',
      extension: 'lonely',
      grant: 'task:cancel-any',
    });
  });

  it.each(['sessions', 'tasks', 'outputs', 'provider'])(
    'is skipped, not activated, when its manifest still requires the removed %s service',
    async (removed) => {
      let activated = false;
      const stale = defineExtension({
        origin,
        manifest: manifestOf({ name: 'stale', services: { requires: [removed] } }),
        activate: () => {
          activated = true;

          return {};
        },
      });
      const harness = await open({ extensions: [stale] });

      expect(activated).toBe(false);
      expect(harness.skippedExtensions).toEqual([
        { extension: 'stale', reason: 'service', missing: [removed] },
      ]);
    },
  );

  it('is skipped when it requires output-reader and the app has no output store, and activates with optional', async () => {
    const activated: string[] = [];
    const reading = (name: string, services: { requires?: string[]; optional?: string[] }) =>
      defineExtension({
        origin,
        manifest: manifestOf({ name, grants: ['output:read'], services }),
        activate: () => {
          activated.push(name);

          return {};
        },
      });
    const harness = await open({
      extensions: [
        reading('needs', { requires: [OUTPUT_READER.name] }),
        reading('maybe', { optional: [OUTPUT_READER.name] }),
      ],
    });

    expect(activated).toEqual(['maybe']);
    expect(harness.skippedExtensions).toEqual([
      { extension: 'needs', reason: 'service', missing: [OUTPUT_READER.name] },
    ]);
  });

  it('has every scope it held throw `deactivated` once the run’s main session ends', async () => {
    const { probe, harness, main: id } = await openProbe(ALL_GRANTS);
    const { info, child, tasks, control, approvals, model } = probe.scopes();
    // Synchronous members only: polling an async one that is still armed would run it.
    const polled = [
      () => info.get(id),
      () => child.startChild({ parentId: id, startedByCall: callIdSchema.parse('c'), title: 't' }),
      () => tasks.list(),
      () => control.list(id),
      () => approvals.listening,
      () => model.stream(noRequest),
    ];
    const isDeactivated = (call: () => unknown) => {
      try {
        call();
      } catch (caughtError) {
        return caughtError instanceof ScopeDeactivatedError;
      }

      return false;
    };

    harness.sessions.end({ id, state: 'completed' });
    await until(() => polled.every(isDeactivated));

    for (const [grant, call] of guardedCalls({ probe, main: id })) {
      await expect(outcomeOf(call), grant).rejects.toBeInstanceOf(ScopeDeactivatedError);
    }
  });
});
