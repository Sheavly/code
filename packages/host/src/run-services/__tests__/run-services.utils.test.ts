import { describe, expect, it } from 'vitest';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createHarness } from '../../host/host.helper.js';
import {
  APPROVALS,
  INSTRUCTIONS,
  MAIN_SESSION,
  OUTPUTS,
  PROVIDER,
  runServices,
  SESSIONS,
  TASKS,
} from '../run-services.utils.js';

const harness = () => createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });

describe('runServices', () => {
  it('supplies every key of the run, outputs included, as the harness’s own objects', () => {
    const run = harness();
    const outputs = new MemoryOutputStore();
    const byName = new Map(
      runServices({ harness: run, outputs }).map((service) => [service.name, service.value]),
    );

    expect(byName.get(PROVIDER.name)).toBe(run.provider);
    expect(byName.get(INSTRUCTIONS.name)).toBe(run.instructions);
    expect(byName.get(SESSIONS.name)).toBe(run.sessions);
    expect(byName.get(MAIN_SESSION.name)).toBe(run.mainSession);
    expect(byName.get(TASKS.name)).toBe(run.tasks);
    expect(byName.get(OUTPUTS.name)).toBe(outputs);
  });

  it('leaves OUTPUTS out when the app has no output store, and supplies no environment', () => {
    const names = runServices({ harness: harness() }).map((service) => service.name);

    expect(names).not.toContain(OUTPUTS.name);
    expect(names).not.toContain('env');
    expect(names).toHaveLength(6);
  });

  it('supplies APPROVALS as a request-only view: no respond, subscribe, observe, pending or screen', () => {
    const run = harness();
    const host = new ExtensionHost({ extensions: [], services: runServices({ harness: run }) });
    const approvals = host.service(APPROVALS);

    expect(approvals).not.toBe(run.approvals);
    expect(Object.keys(approvals)).toEqual(['request']);

    for (const name of ['respond', 'subscribe', 'observe', 'pending', 'screen']) {
      expect(name in approvals).toBe(false);
    }
  });

  it('requests through the real registry, which a UI then answers', async () => {
    const run = harness();
    const host = new ExtensionHost({ extensions: [], services: runServices({ harness: run }) });

    // The UI's side: it answers whatever the extension's request announces.
    run.approvals.subscribe((update) => {
      if (update.type !== 'approval_requested') return;

      run.approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
    });

    await expect(
      host.service(APPROVALS).request({
        callId: callIdSchema.parse('c1'),
        tool: 'run_command',
        command: 'ls',
        concerns: [],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ decision: 'approve' });
  });

  it('lets an extension read them through the host without depending on anything', async () => {
    const run = harness();
    const host = new ExtensionHost({
      extensions: [],
      services: runServices({ harness: run }),
    });

    expect(host.service(TASKS)).toBe(run.tasks);
    expect(host.service(SESSIONS)).toBe(run.sessions);
  });
});
