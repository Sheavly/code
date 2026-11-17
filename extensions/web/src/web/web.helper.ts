import type { Extension } from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';
import { createWebFetchTool } from '@sheavly/tools/web-fetch/web-fetch.tool';
import { createWebSearchTool } from '@sheavly/tools/web-search/web-search.tool';
import type { WebExtensionOptions } from './web.types.js';

/**
 * Public web reading and search, for the main run and its sub-agents alike. It depends on
 * `agents` only to share its tools with the sub-agents that extension starts.
 */
export function createWebExtension(options: WebExtensionOptions): Extension {
  const { webFetch, webSearch } = options;

  return defineExtension({
    name: 'web',
    dependsOn: ['agents'],
    activate: ({ services }) => {
      const tools = [
        ...(webFetch === false ? [] : [createWebFetchTool(webFetch)]),
        ...(webSearch === false ? [] : [createWebSearchTool(webSearch)]),
      ];

      services.get(SUB_AGENTS).share({ tools });

      return { tools };
    },
  });
}
