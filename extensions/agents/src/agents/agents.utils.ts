import type { ServiceConsumer } from '@sheavly/extension/extension/extension.types';
import { defineService } from '@sheavly/extension/extension/extension.utils';
import { requireGrant } from '@sheavly/extension/extension/grants.utils';
import { ScopeDeactivatedError } from '@sheavly/host/errors/scopes.errors';
import { SubAgentShareError } from '../errors/agents.errors.js';
import { OWN_SUB_AGENT_TOOLS, SUB_AGENT_SHARE_GRANT } from './agents.constants.js';
import type {
  RawSubAgentScope,
  SubAgentScope,
  SubAgentShare,
  SubAgentShared,
} from './agents.types.js';

/**
 * The write-only service an extension reads to share tools and hooks with sub-agents, one scope
 * per consumer. It must depend on `agents` (`dependsOn: ['agents']`), list `sub-agents` in
 * `services.requires` and declare the `sub-agent:share` grant to call `share`.
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
 * The scope `consumer` holds: frozen and write-only like the raw one it delegates to. `share`
 * throws a `ScopeDeactivatedError` once `disarm` ran, then an `ExtensionUndeclaredError` unless the
 * consumer's manifest declares `sub-agent:share`; only then does the raw scope validate and keep,
 * labelled with the consumer's name. `disarm` also revokes everything the consumer shared, so
 * what an extension that failed, was rolled back or stopped put in reaches no new sub-agent.
 */
export function createConsumerScope(params: { raw: RawSubAgentScope; consumer: ServiceConsumer }): {
  value: SubAgentScope;
  disarm: () => void;
} {
  const { raw, consumer } = params;
  // The frozen snapshot's name, read once: it labels everything this scope shares.
  const owner = consumer.name;
  let armed = true;
  const scope: SubAgentScope = Object.freeze({
    share: (input: SubAgentShare) => {
      if (!armed) {
        throw new ScopeDeactivatedError({ extension: owner, service: SUB_AGENTS.name });
      }

      requireGrant({
        extension: owner,
        grants: consumer.manifest.grants ?? [],
        grant: SUB_AGENT_SHARE_GRANT,
      });
      raw.share(input, owner);
    },
  });

  return {
    value: scope,
    disarm: () => {
      armed = false;
      raw.revoke(owner);
    },
  };
}

/** Takes every entry of `list` that `owner` shared out of it, in place: the lists are read live. */
function removeOwnedBy(params: {
  list: object[];
  owners: WeakMap<object, string>;
  owner: string;
}): void {
  const { list, owners, owner } = params;
  const kept = list.filter((entry) => owners.get(entry) !== owner);

  list.splice(0, list.length, ...kept);
}

/**
 * Nothing shared yet: the frozen, write-only `scope` (the agents extension's own, with no grant
 * check; consumers get `createConsumerScope` over it) and the `shared` lists it appends to, which
 * stay with the caller and are never provided. An entry shared with an `owner` is taken out of
 * the lists by `revoke(owner)`; one shared with none (the agents extension's own) never is.
 */
export function createSubAgentScope(): { scope: RawSubAgentScope; shared: SubAgentShared } {
  const shared: SubAgentShared = { tools: [], taskTools: [], hooks: [] };
  const owners = new WeakMap<object, string>();
  const scope: RawSubAgentScope = Object.freeze({
    revoke: (owner: string) => {
      for (const list of [shared.tools, shared.taskTools, shared.hooks]) {
        removeOwnedBy({ list, owners, owner });
      }
    },
    share: (input: SubAgentShare, owner?: string) => {
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

      if (owner !== undefined) {
        for (const entry of [...tools, ...taskTools, ...hooks]) owners.set(entry, owner);
      }

      // Task-starting tools are tools sub-agents get like any other; their list only records that some exist.
      shared.tools.push(...tools, ...taskTools);
      shared.taskTools.push(...taskTools);
      shared.hooks.push(...hooks);
    },
  });

  return { scope, shared };
}
