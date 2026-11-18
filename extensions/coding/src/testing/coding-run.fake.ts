import path from 'node:path';
import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import type { Tool } from '@sheavly/core/tool/tool.types';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import { noSubAgentRuns } from '@sheavly/host/testing/run-loop.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { memoryShellStore } from '@sheavly/workspace/working-root/memory-shell.helper';
import { createCodingExtension } from '../extension/coding-extension.helper.js';
import { TrustStore } from '../trust/trust.service.js';
import { testPermissions } from './permissions.fake.js';
import { memoryTrust } from './trust.fake.js';
import type { CodingRunParams } from './testing.types.js';

/**
 * Test-only: the coding extension (with `agents`) activated as an app activates it, over a real
 * harness and the run services built from it. `activate` can be called again for a run that is
 * reopened over the same harness and shell. A test holds the extension to what a third party
 * has: the tools it contributes, called with a session.
 */
export function codingRun(params: CodingRunParams) {
  const harness =
    params.harness ?? createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
  const shell = params.shell ?? memoryShellStore();

  return {
    harness,
    shell,
    async activate() {
      const coding = createCodingExtension({
        workspaceRoot: params.project,
        scratchRoot: params.scratchRoot,
        fileLocks: params.fileLocks,
        env: params.env ?? {},
        permissions: params.permissions ?? testPermissions(),
        trustStore: new TrustStore({
          persistence: memoryTrust({ file: path.join(params.project, '..', 'trusted.json') }),
        }),
        trustWorkspace: true,
        shell,
      });
      const host = new ExtensionHost({
        extensions: [createAgentsExtension(), params.adjust?.(coding) ?? coding],
        services: runServices({
          harness,
          outputs: params.outputs,
          runSession: noSubAgentRuns,
        }),
      });
      const result = await host.activate({ signal: new AbortController().signal });

      return {
        result,
        deactivate: () => host.deactivate(),
        tool(name: string): Tool {
          const found = result.contributions.tools.find((candidate) => candidate.name === name);

          if (!found) throw new Error(`${name} is not in the run`);

          return found;
        },
      };
    },
  };
}
