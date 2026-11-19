import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { Extension } from '@sheavly/extension/extension/extension.types';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import type { RunLoop } from '@sheavly/host/run-services/run-services.types';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import type { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { fakeExtension } from '@sheavly/extension/testing/extension.fake';
import { SUB_AGENT_SHARE_GRANT } from '../agents/agents.constants.js';
import { createAgentsExtension } from '../agents/agents.helper.js';
import type { AgentsExtensionOptions, SubAgentScope } from '../agents/agents.types.js';
import { SUB_AGENTS } from '../agents/agents.utils.js';

/** An extension named `sharer` that holds `sub-agent:share` and calls `share` with its scope while it activates. */
export function sharingExtension(share: (scope: SubAgentScope) => void) {
  return fakeExtension({
    name: 'sharer',
    dependsOn: ['agents'],
    requires: [SUB_AGENTS.name],
    grants: [SUB_AGENT_SHARE_GRANT],
    activate: ({ services }) => {
      share(services.get(SUB_AGENTS));

      return {};
    },
  });
}

/** Activates `agents` (and `extras`) on host services built from a real harness, as an app does. */
export async function activateAgents(params: {
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
export async function startedWith(run: Awaited<ReturnType<typeof activateAgents>>) {
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
