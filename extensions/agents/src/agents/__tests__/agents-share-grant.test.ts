import { describe, expect, it } from 'vitest';
import {
  ExtensionGrantError,
  ExtensionUndeclaredError,
} from '@sheavly/extension/errors/manifest.errors';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { fakeExtension, fakeHook, fakeTool } from '@sheavly/extension/testing/extension.fake';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { SubAgentShareError } from '../../errors/agents.errors.js';
import { activateAgents, startedWith } from '../../testing/agents-run.fake.js';
import { SUB_AGENT_SHARE_GRANT } from '../agents.constants.js';
import { createAgentsExtension } from '../agents.helper.js';
import type { SubAgentScope } from '../agents.types.js';
import { SUB_AGENTS } from '../agents.utils.js';

/** An extension that reads `sub-agents` in `activate` and keeps what it was given. */
function consumer(name: string, grants: string[]) {
  const held: { scope?: SubAgentScope } = {};
  const extension = fakeExtension({
    name,
    dependsOn: ['agents'],
    requires: [SUB_AGENTS.name],
    grants,
    activate: ({ services }) => {
      held.scope = services.get(SUB_AGENTS);

      return {};
    },
  });

  return { extension, held };
}

describe('sharing with sub-agents needs the sub-agent:share grant', () => {
  it('lets a consumer that declares it share, and its tool and hook reach a sub-agent', async () => {
    const { extension, held } = consumer('sharer', [SUB_AGENT_SHARE_GRANT]);
    const run = await activateAgents({ extras: [extension] });

    held.scope!.share({ tools: [fakeTool('mine')], hooks: [fakeHook('mine-hook')] });

    const { tools, hooks } = await startedWith(run);

    expect(run.result.failed).toEqual([]);
    expect(tools.map((tool) => tool.name)).toContain('mine');
    expect(hooks.map((hook) => hook.name)).toEqual(['mine-hook']);
  });

  it('refuses a consumer that does not declare it, naming the extension and the grant, and shares nothing', async () => {
    const { extension, held } = consumer('intruder', []);
    const run = await activateAgents({ extras: [extension] });
    const attempt = () =>
      held.scope!.share({ tools: [fakeTool('sneaky')], hooks: [fakeHook('h')] });

    expect(run.result.failed).toEqual([]);
    expect(attempt).toThrow(ExtensionUndeclaredError);
    expect(attempt).toThrow(/intruder/);
    expect(attempt).toThrow(
      expect.objectContaining({
        extension: 'intruder',
        use: 'grant',
        undeclared: SUB_AGENT_SHARE_GRANT,
      }),
    );

    const { tools, hooks } = await startedWith(run);

    expect(tools.map((tool) => tool.name)).not.toContain('sneaky');
    expect(hooks).toEqual([]);
  });

  it('gives each consumer its own scope, while the shared lists and the names in them are common', async () => {
    const first = consumer('first', [SUB_AGENT_SHARE_GRANT]);
    const second = consumer('second', [SUB_AGENT_SHARE_GRANT]);
    const run = await activateAgents({ extras: [first.extension, second.extension] });

    first.held.scope!.share({ tools: [fakeTool('taken')] });

    expect(second.held.scope).not.toBe(first.held.scope);
    expect(() => second.held.scope!.share({ tools: [fakeTool('taken')] })).toThrow(
      SubAgentShareError,
    );

    second.held.scope!.share({ tools: [fakeTool('free')] });

    const { tools } = await startedWith(run);
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('taken');
    expect(names).toContain('free');
  });

  it('shares its own output tools with no grant: agents is not a consumer of its own service', async () => {
    const run = await activateAgents({ outputs: new MemoryOutputStore() });
    const { tools } = await startedWith(run);

    expect(run.result.failed).toEqual([]);
    expect(createAgentsExtension().manifest.grants ?? []).not.toContain(SUB_AGENT_SHARE_GRANT);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['read_output', 'search_output']),
    );
  });

  it('throws ScopeDeactivatedError from share once the consumer is stopped, naming it and the service', async () => {
    const { extension, held } = consumer('sharer', [SUB_AGENT_SHARE_GRANT]);
    const run = await activateAgents({ extras: [extension] });

    await run.host.deactivate();

    const attempt = () => held.scope!.share({ tools: [fakeTool('late')] });

    expect(attempt).toThrow(ScopeDeactivatedError);
    expect(attempt).toThrow(/"sub-agents" service of extension "sharer"/);
  });

  it('is frozen and offers only share', async () => {
    const { extension, held } = consumer('sharer', [SUB_AGENT_SHARE_GRANT]);

    await activateAgents({ extras: [extension] });

    expect(Reflect.ownKeys(held.scope!)).toEqual(['share']);
    expect(Object.isFrozen(held.scope)).toBe(true);
  });

  it('fails the activation of an extension that lists the grant without reading sub-agents', async () => {
    const stray = fakeExtension({
      name: 'stray',
      dependsOn: ['agents'],
      grants: [SUB_AGENT_SHARE_GRANT],
    });
    const { result } = await activateAgents({ extras: [stray] });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.extension).toBe('stray');
    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionGrantError);
    expect(String(result.failed[0]?.cause)).toContain(SUB_AGENT_SHARE_GRANT);
  });
});
