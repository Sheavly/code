import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { routedProvider, say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import type { SearchBackend } from '@sheavly/tools/web-search/web-search.types';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { memoryTrust } from '@sheavly/coding/testing/trust.fake';
import { TrustStore } from '@sheavly/coding/trust/trust.service';
import { createBackendHarness } from '../harness.helper.js';
import { askingPermissions } from '../../testing/permissions.fake.js';

const workspace = useTempWorkspace({ prefix: 'backend-search-', perTest: true });

describe('the app-selected search backend', () => {
  it('serves main and child searches through the same injected backend', async () => {
    const searches: string[] = [];
    const requests: ProviderRequest[] = [];
    const backend: SearchBackend = {
      name: 'custom',
      search: async ({ query, signal }) => {
        signal.throwIfAborted();
        searches.push(query);

        return [{ title: query, url: 'https://example.com/docs', snippet: 'Search evidence' }];
      },
    };
    const search = (id: string, query: string) => () => [
      toolCall({ id, name: 'web_search', input: { query } }),
      { type: 'done' as const, stopReason: 'tool_use' as const },
    ];
    const harness = await createBackendHarness({
      provider: routedProvider({
        go: [
          search('main-search', 'main query'),
          () => [
            toolCall({
              id: 'start',
              name: 'start_agent',
              input: { title: 'Helper', task: 'help' },
            }),
            { type: 'done', stopReason: 'tool_use' },
          ],
          say('done'),
        ],
        help: [search('child-search', 'child query'), say('helped')],
      }),
      title: 'go',
      workspaceRoot: workspace.root,
      trustStore: new TrustStore({
        persistence: memoryTrust({ file: path.join(workspace.base, 'trusted.json') }),
      }),
      env: {},
      permissions: askingPermissions(),
      webSearch: { backend },
      onModelCall: (request) => requests.push(request),
    });
    const conversation = createConversation({
      harness,
      hooks: harness.hooks,
      tools: harness.tools,
      run: streamAgent,
    });

    try {
      for await (const _event of conversation.send('go'));
    } finally {
      await conversation.close();
    }

    expect(searches).toEqual(['main query', 'child query']);
    const main = requests.find((request) => request.messages[0]?.content === 'go');
    const child = requests.find((request) => request.messages[0]?.content === 'help');

    expect(main?.tools.find((tool) => tool.name === 'web_search')).toEqual(
      child?.tools.find((tool) => tool.name === 'web_search'),
    );
    const toolResults = requests
      .flatMap((request) => request.messages)
      .filter((message) => message.role === 'tool');

    expect(toolResults.some((message) => message.content.includes('Search evidence'))).toBe(true);
  });
});
