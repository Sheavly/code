import { defineService } from '@sheavly/extension/extension/extension.utils';
import { SubAgentShareError } from '../errors/agents.errors.js';
import { OWN_SUB_AGENT_TOOLS } from './agents.constants.js';
import type { SubAgentScope, SubAgentShare, SubAgentShared } from './agents.types.js';

/**
 * The write-only service an extension reads to share tools and hooks with sub-agents. It must
 * depend on `agents` (`dependsOn: ['agents']`) to read it. A grant cannot be defined by a service
 * an extension provides, so reading it is gated by `requires` alone.
 */
export const SUB_AGENTS = defineService<SubAgentScope>('sub-agents');

/**
 * Throws a `SubAgentShareError` unless every entry is an object with a non-empty string `name`
 * that is not in `taken` (names shared before) and not repeated in `entries`, and, for a tool,
 * is not one the agents extension gives every sub-agent itself.
 */
function assertShareable(params: {
  entries: readonly unknown[];
  kind: 'tool' | 'hook';
  taken: ReadonlySet<string>;
}): void {
  const { entries, kind, taken } = params;
  const seen = new Set<string>();

  for (const entry of entries) {
    const name = (entry as { name?: unknown } | null)?.name;

    if (typeof entry !== 'object' || typeof name !== 'string' || name === '') {
      throw new SubAgentShareError({
        problem: 'invalid',
        message: `A shared ${kind} must be an object with a non-empty string name`,
      });
    }

    if (kind === 'tool' && OWN_SUB_AGENT_TOOLS.includes(name)) {
      throw new SubAgentShareError({
        problem: 'reserved',
        message: `The tool name ${name} is one every sub-agent already gets from the agents extension`,
      });
    }

    if (taken.has(name) || seen.has(name)) {
      throw new SubAgentShareError({
        problem: 'duplicate',
        message: `A ${kind} named ${name} is already shared with sub-agents`,
      });
    }

    seen.add(name);
  }
}

/**
 * Nothing shared yet: the frozen, write-only `scope` to provide as the service, and the `shared`
 * lists it appends to, which stay with the caller and are never provided.
 */
export function createSubAgentScope(): { scope: SubAgentScope; shared: SubAgentShared } {
  const shared: SubAgentShared = { tools: [], taskTools: [], hooks: [] };
  const scope: SubAgentScope = Object.freeze({
    share: (input: SubAgentShare) => {
      // Shallow copies, taken once: a getter or proxy `name` is read here and nowhere else, so the
      // name that passed the checks is the name sub-agents get.
      const tools = (input.tools ?? []).map((tool) => ({ ...tool }));
      const taskTools = (input.taskTools ?? []).map((tool) => ({ ...tool }));
      const hooks = (input.hooks ?? []).map((hook) => ({ ...hook }));

      // All checked before anything is kept, so a rejected call shares nothing.
      assertShareable({
        entries: [...tools, ...taskTools],
        kind: 'tool',
        taken: new Set(shared.tools.map((tool) => tool.name)),
      });
      assertShareable({
        entries: hooks,
        kind: 'hook',
        taken: new Set(shared.hooks.map((hook) => hook.name)),
      });
      // Task-starting tools are tools sub-agents get like any other; their list only records that some exist.
      shared.tools.push(...tools, ...taskTools);
      shared.taskTools.push(...taskTools);
      shared.hooks.push(...hooks);
    },
  });

  return { scope, shared };
}
