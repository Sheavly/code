import { describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { registryScopes } from '@sheavly/tools/testing/registry-scopes.fake';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import { createHarness } from '../host.helper.js';

describe('shared child instructions', () => {
  it('shares the base once with pinned cross-model children and descendants, not parent overrides', async () => {
    const childRequests: ProviderRequest[] = [];
    const childProvider = routedProvider({
      'child task': [
        calls(
          toolCall({
            id: 'nested',
            name: 'start_agent',
            input: { title: 'Nested', task: 'nested task' },
          }),
        ),
        say('child done'),
      ],
      'nested task': [say('nested done')],
    });
    const providers = new ProviderSwitch()
      .add(
        'parent-model',
        routedProvider({
          'parent task': [
            calls(
              toolCall({
                id: 'child',
                name: 'start_agent',
                input: { title: 'Child', task: 'child task' },
              }),
            ),
            say('parent done'),
          ],
        }),
      )
      .add('different-family', {
        stream(request) {
          childRequests.push(request);

          return childProvider.stream(request);
        },
      });
    const harness = createHarness({ provider: providers, title: 'Parent', instructions: 'HOST' });
    const child = createSubAgentTool({
      scopes: registryScopes({
        sessions: harness.sessions,
        tasks: harness.tasks,
        runAgent: runSession,
      }),
      provider: harness.provider,
      selectProvider: () => ({ provider: providers.pinned('different-family') }),
      baseInstructions: harness.instructions,
      instructions: 'CHILD EXTRAS',
      tools: [],
    });

    const result = await runSession({
      provider: harness.provider,
      instructions: 'PARENT ONLY',
      tools: [child],
      messages: [{ role: 'user', content: 'parent task' }],
      tasks: harness.tasks,
      session: { registry: harness.sessions, ref: harness.mainSession },
    });

    expect(result.reason).toBe('completed');
    // Child completion can wake its parent before or after the parent's final scripted reply.
    expect(childRequests.length).toBeGreaterThanOrEqual(3);
    expect(childRequests.some((request) => request.messages[0]?.content === 'nested task')).toBe(
      true,
    );

    for (const request of childRequests) {
      expect(
        request.instructions?.startsWith(`${harness.instructions}\n\n# Sub-agent role\n`),
      ).toBe(true);
      expect(request.instructions?.endsWith('\n\nCHILD EXTRAS')).toBe(true);
      expect(request.instructions?.split(harness.instructions)).toHaveLength(2);
      expect(request.instructions?.split('# Sub-agent role')).toHaveLength(2);
      expect(request.messages.some((message) => message.content === 'parent task')).toBe(false);
    }

    expect(new Set(childRequests.map((request) => request.instructions)).size).toBe(1);
  });
});
