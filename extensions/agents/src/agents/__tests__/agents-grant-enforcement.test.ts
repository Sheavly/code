import { describe, expect, it } from 'vitest';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import { assertServiceEnforcesGrants } from '@sheavly/extension/testing/service-grants.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { SUB_AGENT_SHARE_GRANT } from '../agents.constants.js';
import { createAgentsExtension } from '../agents.helper.js';
import { SUB_AGENTS } from '../agents.utils.js';

describe('the agents extension enforces every grant its sub-agents service declares', () => {
  it('refuses share without sub-agent:share, and accepts it with the grant', async () => {
    const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });

    await assertServiceEnforcesGrants({
      provider: createAgentsExtension(),
      service: SUB_AGENTS,
      services: runServices({
        harness,
        runSession: (options) =>
          Promise.resolve({ reason: 'completed', messages: options.messages }),
      }),
      calls: { [SUB_AGENT_SHARE_GRANT]: (scope) => scope.share({ tools: [] }) },
    });

    expect(createAgentsExtension().manifest.services?.grants?.[SUB_AGENTS.name]).toEqual([
      SUB_AGENT_SHARE_GRANT,
    ]);
  });
});
