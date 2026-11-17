import { defineService } from '@sheavly/extension/extension/extension.utils';
import type { SubAgentScope } from './agents.types.js';

/**
 * The service an extension reads to share tools and hooks with sub-agents. It must depend on
 * `agents` (`dependsOn: ['agents']`) to read it.
 */
export const SUB_AGENTS = defineService<SubAgentScope>('sub-agents');

/** A scope with nothing shared yet; `share` appends to its lists. */
export function createSubAgentScope(): SubAgentScope {
  const scope: SubAgentScope = {
    tools: [],
    taskTools: [],
    hooks: [],
    share: ({ tools = [], taskTools = [], hooks = [] }) => {
      // Task-starting tools are tools sub-agents get like any other; their list only records that some exist.
      scope.tools.push(...tools, ...taskTools);
      scope.taskTools.push(...taskTools);
      scope.hooks.push(...hooks);
    },
  };

  return scope;
}
