import { describe, expect, it } from 'vitest';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
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
} from '@sheavly/extension/run-services/run-services.utils';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createHarness } from '../../host/host.helper.js';
import { scopeRun } from '../../testing/scope-run.fake.js';
import { runServices } from '../run-services.helper.js';

const harness = () => createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });

describe('runServices', () => {
  it('supplies the two read-only values, and nothing else as the harness’s own object', () => {
    const run = harness();
    const services = runServices({ harness: run, outputs: new MemoryOutputStore(), runSession });
    const plain = new Map(
      services.flatMap((service) => ('value' in service ? [[service.name, service.value]] : [])),
    );

    expect([...plain.keys()].sort()).toEqual([INSTRUCTIONS.name, MAIN_SESSION.name].sort());
    expect(plain.get(INSTRUCTIONS.name)).toEqual({ text: run.instructions });
    expect(plain.get(MAIN_SESSION.name)).toEqual(run.mainSession);
  });

  it('shares the prompt as a frozen view that reads what the harness composes at that moment', () => {
    const run = harness();
    const view = runServices({ harness: run, runSession })
      .filter((service) => service.name === INSTRUCTIONS.name)
      .map((service) => ('value' in service ? (service.value as { text: string }) : undefined))[0];
    const before = view?.text;

    run.systemPrompt.contribute({ sections: [{ name: 's', text: '# Late' }] });

    expect(Object.isFrozen(view)).toBe(true);
    expect(view?.text).toBe(`${before}\n\n# Late`);
    expect(view).not.toHaveProperty('contribute');
  });

  it('shares a frozen copy of the main session, so no extension can change the harness’s own', () => {
    const run = harness();
    const shared = runServices({ harness: run, runSession })
      .filter((service) => service.name === MAIN_SESSION.name)
      .map((service) => ('value' in service ? (service.value as { id: string }) : undefined))[0];
    const before = run.mainSession.id;

    expect(shared).not.toBe(run.mainSession);
    expect(Object.isFrozen(shared)).toBe(true);
    expect(() => {
      if (shared) shared.id = 'hijacked';
    }).toThrow(TypeError);
    expect(run.mainSession.id).toBe(before);
  });

  it('supplies the scoped services as factories declaring their grants', () => {
    const grants = new Map(
      runServices({ harness: harness(), outputs: new MemoryOutputStore(), runSession }).map(
        (service) => [service.name, 'grants' in service ? [...service.grants] : undefined],
      ),
    );

    expect(grants.get(SESSION_INFO.name)).toEqual(['session:read']);
    expect(grants.get(CHILD_SESSIONS.name)).toEqual([
      'sub-agent:create',
      'sub-agent:message',
      'sub-agent:observe',
      'sub-agent:report',
    ]);
    expect(grants.get(BACKGROUND_TASKS.name)).toEqual(['task:start', 'task:read', 'task:cancel']);
    expect(grants.get(TASK_CONTROL.name)).toEqual(['task:read-any', 'task:cancel-any']);
    expect(grants.get(OUTPUT_READER.name)).toEqual(['output:read']);
    expect(grants.get(OUTPUT_CAPTURE.name)).toEqual(['output:capture']);
    expect(grants.get(MODEL.name)).toEqual(['model:call']);
    expect(grants.get(APPROVALS.name)).toEqual([
      'approval:request',
      'approval:as-tool',
      'approval:keep',
    ]);
  });

  it('keeps the output grants known when the app has no output store, and supplies no environment or whole registry', () => {
    const names = runServices({ harness: harness(), runSession }).map((service) => service.name);

    expect(names).toContain(OUTPUT_READER.name);
    expect(names).toContain(OUTPUT_CAPTURE.name);
    expect(names).not.toContain('env');

    for (const removed of ['sessions', 'tasks', 'outputs', 'provider']) {
      expect(names).not.toContain(removed);
    }

    expect(names).toHaveLength(10);
  });

  it('refuses to hand a scoped service to the app: only an extension can read it', () => {
    const host = new ExtensionHost({
      extensions: [],
      services: runServices({ harness: harness(), runSession }),
    });

    expect(() => host.service(SESSION_INFO)).toThrow(/built per extension/);
  });
});

describe('the scoped services of one run', () => {
  const reader = {
    name: 'reader',
    requires: [SESSION_INFO.name, MODEL.name],
    grants: ['session:read', 'model:call'],
  };

  it('builds each service once per extension and gives two extensions distinct instances', async () => {
    const run = scopeRun();

    await run.activate([reader, { ...reader, name: 'other' }]);

    const first = run.servicesOf('reader');

    expect(first.get(SESSION_INFO)).toBe(first.get(SESSION_INFO));
    expect(first.get(SESSION_INFO)).not.toBe(run.servicesOf('other').get(SESSION_INFO));
  });

  it('freezes every scope', async () => {
    const run = scopeRun({ outputs: new MemoryOutputStore() });

    await run.activate([
      {
        name: 'all',
        requires: [
          SESSION_INFO.name,
          CHILD_SESSIONS.name,
          BACKGROUND_TASKS.name,
          TASK_CONTROL.name,
          MODEL.name,
          OUTPUT_READER.name,
          OUTPUT_CAPTURE.name,
        ],
        grants: [],
      },
    ]);

    const services = run.servicesOf('all');

    for (const scope of [
      services.get(SESSION_INFO),
      services.get(CHILD_SESSIONS),
      services.get(BACKGROUND_TASKS),
      services.get(TASK_CONTROL),
      services.get(MODEL),
      services.get(OUTPUT_READER),
      services.get(OUTPUT_CAPTURE),
    ]) {
      expect(Object.isFrozen(scope)).toBe(true);
    }
  });

  it('forwards the provider’s context window live and its stream, once model:call is granted', async () => {
    const run = scopeRun();

    await run.activate([reader]);

    const model = run.servicesOf('reader').get(MODEL);

    expect(model.contextWindow).toBe(run.harness.provider.contextWindow);
    expect(typeof model.stream).toBe('function');
  });
});
