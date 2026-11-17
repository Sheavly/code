import { describe, expect, it } from 'vitest';
import type { Extension } from '@sheavly/extension/extension/extension.types';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { fakeExtension, fakeHook, fakeTool } from '@sheavly/extension/testing/extension.fake';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.utils';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { createAgentsExtension } from '../agents.helper.js';
import type { AgentsExtensionOptions } from '../agents.types.js';
import { SUB_AGENTS } from '../agents.utils.js';

/** Activates `agents` (and `extras`) on host services built from a real harness, as an app does. */
async function activate(params: {
  options?: AgentsExtensionOptions;
  outputs?: MemoryOutputStore;
  extras?: Extension[];
}) {
  const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
  const host = new ExtensionHost({
    extensions: [createAgentsExtension(params.options), ...(params.extras ?? [])],
    services: runServices({ harness, outputs: params.outputs }),
  });
  const result = await host.activate({ signal: new AbortController().signal });

  return { host, names: result.contributions.tools.map((tool) => tool.name), result };
}

describe('the agents extension', () => {
  it('contributes the task tools, start_agent and message_agent from the run services', async () => {
    const { names, result } = await activate({});

    expect(result.failed).toEqual([]);
    expect(names).toEqual(
      expect.arrayContaining(['task_status', 'cancel_task', 'start_agent', 'message_agent']),
    );
  });

  it('adds read_output and search_output only when the host supplies an output store', async () => {
    const without = await activate({});
    const withStore = await activate({ outputs: new MemoryOutputStore() });

    expect(without.names).not.toContain('read_output');
    expect(withStore.names).toEqual(expect.arrayContaining(['read_output', 'search_output']));
  });

  it('adds the history tools only with logOf', async () => {
    const log = {
      append: async () => undefined,
      async *read() {
        yield* [];
      },
    };
    const without = await activate({});
    const withLog = await activate({ options: { logOf: () => log } });

    expect(without.names).not.toContain('search_history');
    expect(withLog.names).toEqual(expect.arrayContaining(['search_history', 'read_history_entry']));
  });

  it('shares its output tools with sub-agents, ahead of what other extensions share', async () => {
    const sharer = fakeExtension({
      name: 'sharer',
      dependsOn: ['agents'],
      activate: ({ services }) => {
        services.get(SUB_AGENTS).share({ tools: [fakeTool('shared_tool')] });

        return {};
      },
    });
    const { host } = await activate({ outputs: new MemoryOutputStore(), extras: [sharer] });

    expect(
      host
        .service(SUB_AGENTS)
        .tools.map((tool) => tool.name)
        .slice(0, 3),
    ).toEqual(['read_output', 'search_output', 'shared_tool']);
  });

  it('shares hooks and task tools from a dependent extension to its sub-agents', async () => {
    const sharer = fakeExtension({
      name: 'sharer',
      dependsOn: ['agents'],
      activate: ({ services }) => {
        services
          .get(SUB_AGENTS)
          .share({ taskTools: [fakeTool('start_job')], hooks: [fakeHook('shared-hook')] });

        return {};
      },
    });
    const { host } = await activate({ extras: [sharer] });
    const scope = host.service(SUB_AGENTS);

    expect(scope.hooks.map((hook) => hook.name)).toEqual(['shared-hook']);
    expect(scope.taskTools.map((tool) => tool.name)).toEqual(['start_job']);
  });

  it('fails to activate when the host supplies no run services', async () => {
    const host = new ExtensionHost({ extensions: [createAgentsExtension()] });
    const { failed } = await host.activate({ signal: new AbortController().signal });

    expect(failed).toHaveLength(1);
  });
});
