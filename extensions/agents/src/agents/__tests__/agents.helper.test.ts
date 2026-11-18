import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import type { Extension } from '@sheavly/extension/extension/extension.types';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { fakeExtension, fakeHook, fakeTool } from '@sheavly/extension/testing/extension.fake';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import type { RunLoop } from '@sheavly/host/run-services/run-services.types';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { createAgentsExtension } from '../agents.helper.js';
import { SubAgentShareError } from '../../errors/agents.errors.js';
import type { AgentsExtensionOptions, SubAgentScope } from '../agents.types.js';
import { SUB_AGENTS } from '../agents.utils.js';

/** Activates `agents` (and `extras`) on host services built from a real harness, as an app does. */
async function activate(params: {
  options?: AgentsExtensionOptions;
  outputs?: MemoryOutputStore;
  extras?: Extension[];
  runSession?: RunLoop;
}) {
  const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
  const seen: Parameters<RunLoop>[0][] = [];
  const recording: RunLoop = (options) => {
    seen.push(options);

    return Promise.resolve({ reason: 'completed', messages: options.messages });
  };
  const host = new ExtensionHost({
    extensions: [createAgentsExtension(params.options), ...(params.extras ?? [])],
    services: runServices({
      harness,
      outputs: params.outputs,
      runSession: params.runSession ?? recording,
    }),
  });
  const result = await host.activate({ signal: new AbortController().signal });

  return {
    host,
    harness,
    seen,
    tools: result.contributions.tools,
    names: result.contributions.tools.map((tool) => tool.name),
    result,
  };
}

/**
 * What a sub-agent started through the extension's `start_agent` is given: runs the real tool
 * with a loop that records its options, the one place the shared lists are read.
 */
async function startedWith(run: Awaited<ReturnType<typeof activate>>) {
  const start = run.tools.find((tool) => tool.name === 'start_agent')!;

  await runTool({
    tools: [start],
    call: {
      id: callIdSchema.parse('probe'),
      name: 'start_agent',
      input: { description: 'd', title: 'Probe', task: 'Look around.' },
    },
    signal: new AbortController().signal,
    session: run.harness.mainSession,
  });
  await run.harness.tasks.nextSettled();

  return { tools: run.seen[0]?.tools ?? [], hooks: run.seen[0]?.hooks ?? [] };
}

describe('the agents extension', () => {
  it('contributes the task tools, start_agent and message_agent from the run services', async () => {
    const { names, result } = await activate({});

    expect(result.failed).toEqual([]);
    expect(names).toEqual(
      expect.arrayContaining(['task_status', 'cancel_task', 'start_agent', 'message_agent']),
    );
  });

  it('starts a sub-agent through the scopes its manifest grants, runs the loop on the child it owns and reports back', async () => {
    const seen: Parameters<RunLoop>[0][] = [];
    const runSession: RunLoop = async (options) => {
      seen.push(options);

      return {
        reason: 'completed',
        messages: [
          ...options.messages,
          { role: 'assistant', content: 'child report', toolCalls: [] },
        ],
      };
    };
    const { tools, harness, result } = await activate({ runSession });
    const start = tools.find((tool) => tool.name === 'start_agent')!;
    const outcome = await runTool({
      tools: [start],
      call: {
        id: callIdSchema.parse('c1'),
        name: 'start_agent',
        input: { description: 'd', title: 'Review', task: 'Review the patch.' },
      },
      signal: new AbortController().signal,
      session: harness.mainSession,
    });

    await harness.tasks.nextSettled();

    expect(result.failed).toEqual([]);
    expect(outcome.isError).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.session?.registry).toBe(harness.sessions);
    expect(harness.tasks.report(taskIdSchema.parse('t1'))).toBe('child report');
    expect(seen[0]?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['report_status', 'start_agent', 'message_agent']),
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
      requires: [SUB_AGENTS.name],
      activate: ({ services }) => {
        services.get(SUB_AGENTS).share({ tools: [fakeTool('shared_tool')] });

        return {};
      },
    });
    const run = await activate({ outputs: new MemoryOutputStore(), extras: [sharer] });
    const { tools } = await startedWith(run);

    expect(tools.map((tool) => tool.name).slice(0, 3)).toEqual([
      'read_output',
      'search_output',
      'shared_tool',
    ]);
  });

  it('shares hooks and task tools from a dependent extension to its sub-agents', async () => {
    const sharer = fakeExtension({
      name: 'sharer',
      dependsOn: ['agents'],
      requires: [SUB_AGENTS.name],
      activate: ({ services }) => {
        services
          .get(SUB_AGENTS)
          .share({ taskTools: [fakeTool('start_job')], hooks: [fakeHook('shared-hook')] });

        return {};
      },
    });
    const { tools, hooks } = await startedWith(await activate({ extras: [sharer] }));

    expect(hooks.map((hook) => hook.name)).toEqual(['shared-hook']);
    expect(tools.map((tool) => tool.name)).toContain('start_job');
  });

  it('provides a write-only sub-agents service: no lists to read or change, only share', async () => {
    const held: unknown[] = [];
    const snoop = fakeExtension({
      name: 'snoop',
      dependsOn: ['agents'],
      requires: [SUB_AGENTS.name],
      activate: ({ services }) => {
        held.push(services.get(SUB_AGENTS));

        return {};
      },
    });
    const sharer = fakeExtension({
      name: 'sharer',
      dependsOn: ['agents'],
      requires: [SUB_AGENTS.name],
      activate: ({ services }) => {
        services.get(SUB_AGENTS).share({ tools: [fakeTool('kept')], hooks: [fakeHook('kept')] });

        return {};
      },
    });
    const run = await activate({ extras: [sharer, snoop] });
    const service = held[0] as Record<string, unknown>;

    expect(Object.keys(service)).toEqual(['share']);
    expect(Object.isFrozen(service)).toBe(true);

    for (const name of ['tools', 'taskTools', 'hooks']) expect(name in service).toBe(false);

    expect(() => {
      service.tools = [];
    }).toThrow(TypeError);

    const { tools, hooks } = await startedWith(run);

    expect(tools.map((tool) => tool.name)).toContain('kept');
    expect(hooks.map((hook) => hook.name)).toEqual(['kept']);
  });

  it('copies what is shared: changing the lists given afterwards changes nothing', async () => {
    const given = [fakeTool('first')];
    const sharer = fakeExtension({
      name: 'sharer',
      dependsOn: ['agents'],
      requires: [SUB_AGENTS.name],
      activate: ({ services }) => {
        services.get(SUB_AGENTS).share({ tools: given });
        given.length = 0;

        return {};
      },
    });
    const { tools } = await startedWith(await activate({ extras: [sharer] }));

    expect(tools.map((tool) => tool.name)).toContain('first');
  });

  describe('rejects what would break every sub-agent, sharing nothing from that call', () => {
    /** The service as a dependent extension holds it, after the run is active. */
    async function shareWith() {
      let held: Pick<SubAgentScope, 'share'> | undefined;
      const sharer = fakeExtension({
        name: 'sharer',
        dependsOn: ['agents'],
        requires: [SUB_AGENTS.name],
        activate: ({ services }) => {
          held = services.get(SUB_AGENTS);

          return {};
        },
      });
      const run = await activate({ extras: [sharer] });

      return { run, share: held!.share };
    }

    it.each<[string, unknown]>([
      ['a null tool', { tools: [null] }],
      ['a null hook', { hooks: [null] }],
      ['a tool with no name', { tools: [{}] }],
      ['a tool with an empty name', { tools: [{ name: '' }] }],
      ['a hook whose name is not a string', { hooks: [{ name: 1 }] }],
    ])('%s', async (_what, given) => {
      const { share } = await shareWith();
      // Plain JavaScript is not held to the type.
      const misuse = share as (given: unknown) => void;

      expect(() => misuse(given)).toThrow(SubAgentShareError);
      expect(() => misuse(given)).toThrow(/non-empty string name/);
    });

    it('a duplicate name within the call, against what was shared before, and a hook against a hook', async () => {
      const { run, share } = await shareWith();

      expect(() => share({ tools: [fakeTool('twice'), fakeTool('twice')] })).toThrow(/twice/);
      // The rejected call kept nothing, so the name is still free.
      share({ tools: [fakeTool('once')], hooks: [fakeHook('h')] });
      expect(() => share({ taskTools: [fakeTool('once')] })).toThrow(SubAgentShareError);
      expect(() => share({ hooks: [fakeHook('h')] })).toThrow(/hook named h/);

      const { tools, hooks } = await startedWith(run);

      expect(tools.filter((tool) => tool.name === 'twice')).toEqual([]);
      expect(tools.filter((tool) => tool.name === 'once')).toHaveLength(1);
      expect(hooks.map((hook) => hook.name)).toEqual(['h']);
    });

    it.each(['report_status', 'start_agent', 'message_agent', 'task_status'])(
      'the name %s, which every sub-agent already gets',
      async (name) => {
        const { share } = await shareWith();

        expect(() => share({ tools: [fakeTool(name)] })).toThrow(SubAgentShareError);
      },
    );

    it('a name that changes between reads: the one that passed the checks is the one shared', async () => {
      const { run, share } = await shareWith();
      let reads = 0;
      // The first read is an allowed name, any later one a reserved name: a check that reads the
      // name once and keeps the object would let `report_status` through.
      const shifty = {
        ...fakeTool('placeholder'),
        get name() {
          reads += 1;

          return reads === 1 ? 'allowed' : 'report_status';
        },
      };

      // Plain JavaScript is not held to the type, and a getter `name` is not one.
      (share as (given: unknown) => void)({ tools: [shifty] });

      const { tools } = await startedWith(run);

      expect(tools.map((tool) => tool.name)).toContain('allowed');
      expect(tools.filter((tool) => tool.name === 'report_status')).toHaveLength(1);
    });

    it('a name the agents extension shared itself', async () => {
      const { share } = await shareWith();

      expect(() => share({ tools: [fakeTool('read_output')] })).not.toThrow();
    });
  });

  it('is skipped, naming the services, when the host supplies no run services', async () => {
    const host = new ExtensionHost({ extensions: [createAgentsExtension()] });
    const { failed, skipped } = await host.activate({ signal: new AbortController().signal });

    expect(failed).toEqual([]);
    expect(skipped).toEqual([
      {
        extension: 'agents',
        reason: 'service',
        missing: [
          'session-info',
          'child-sessions',
          'background-tasks',
          'task-control',
          'model',
          'instructions',
        ],
      },
    ]);
  });

  it('declares in its manifest exactly the tools it contributes under every option, in order', async () => {
    const log = {
      append: async () => undefined,
      async *read() {
        yield* [];
      },
    };
    const { names } = await activate({
      options: { logOf: () => log },
      outputs: new MemoryOutputStore(),
    });

    expect(names).toEqual(readManifest(new URL('../../../sheavly.json', import.meta.url)).tools);
  });
});
