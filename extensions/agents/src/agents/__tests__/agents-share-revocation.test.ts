import { describe, expect, it } from 'vitest';
import type { Contributions } from '@sheavly/extension/extension/extension.types';
import { fakeExtension, fakeHook, fakeTool } from '@sheavly/extension/testing/extension.fake';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { activateAgents, startedWith } from '../../testing/agents-run.fake.js';
import { SUB_AGENT_SHARE_GRANT } from '../agents.constants.js';
import type { SubAgentScope } from '../agents.types.js';
import { createConsumerScope, createSubAgentScope, SUB_AGENTS } from '../agents.utils.js';

/** An extension that shares a tool and a hook in `activate`, then ends it as `then` says. */
function sharer(params: {
  name: string;
  share: { tool: string; hook: string };
  then?: (held: { scope?: SubAgentScope }) => Contributions;
}) {
  const { name, share, then = () => ({}) } = params;
  const held: { scope?: SubAgentScope } = {};
  const extension = fakeExtension({
    name,
    dependsOn: ['agents'],
    requires: [SUB_AGENTS.name],
    grants: [SUB_AGENT_SHARE_GRANT],
    workKinds: [`${name}.work`],
    activate: ({ services }) => {
      held.scope = services.get(SUB_AGENTS);
      held.scope.share({ tools: [fakeTool(share.tool)], hooks: [fakeHook(share.hook)] });

      return then(held);
    },
  });

  return { extension, held };
}

const ghost = { tool: 'ghost_tool', hook: 'ghost_hook' };

describe('what an extension shared with sub-agents is revoked when its scope is disarmed', () => {
  it('after its activate throws, a sub-agent started later gets neither its tool nor its hook', async () => {
    const failing = sharer({
      name: 'failing',
      share: ghost,
      then: () => {
        throw new Error('activate failed after share');
      },
    });
    const keeper = sharer({ name: 'keeper', share: { tool: 'kept_tool', hook: 'kept_hook' } });
    const run = await activateAgents({
      extras: [failing.extension, keeper.extension],
      outputs: new MemoryOutputStore(),
    });
    const { tools, hooks } = await startedWith(run);
    const names = tools.map((tool) => tool.name);

    expect(run.result.failed.map((failure) => failure.extension)).toEqual(['failing']);
    expect(names).not.toContain('ghost_tool');
    expect(hooks.map((hook) => hook.name)).toEqual(['kept_hook']);
    // What another live consumer shared stays, and so do agents' own output tools.
    expect(names).toEqual(expect.arrayContaining(['kept_tool', 'read_output', 'search_output']));
  });

  it('after it is rolled back because its contribution changed, with the others still live', async () => {
    const list = [{ name: 'rolled.work', description: 'x', completion: 'finite' as const }];
    const rolled = sharer({
      name: 'rolled',
      share: ghost,
      then: () => ({ workKinds: list }),
    });
    const keeper = sharer({ name: 'keeper', share: { tool: 'kept_tool', hook: 'kept_hook' } });
    const emptier = fakeExtension({
      name: 'late',
      activate: () => (list.splice(0), {}),
    });
    const run = await activateAgents({
      extras: [rolled.extension, keeper.extension, emptier],
    });
    const { tools, hooks } = await startedWith(run);

    expect(run.result.failed.map((failure) => failure.extension)).toEqual(['rolled']);
    expect(tools.map((tool) => tool.name)).not.toContain('ghost_tool');
    expect(tools.map((tool) => tool.name)).toContain('kept_tool');
    expect(hooks.map((hook) => hook.name)).toEqual(['kept_hook']);
  });

  it('after the host deactivates it, nothing it shared stays in the lists (scope level)', () => {
    const { scope: raw, shared } = createSubAgentScope();
    const manifest = { grants: [SUB_AGENT_SHARE_GRANT] };
    const consumerOf = (name: string) =>
      Object.freeze({
        name,
        manifest: manifest as never,
        contributedTools: () => [],
      });
    const mine = createConsumerScope({ raw, consumer: consumerOf('mine') });
    const theirs = createConsumerScope({ raw, consumer: consumerOf('theirs') });

    raw.share({ tools: [fakeTool('own_tool')] });
    mine.value.share({
      tools: [fakeTool('mine_tool')],
      taskTools: [fakeTool('mine_task')],
      hooks: [fakeHook('mine_hook')],
    });
    theirs.value.share({ tools: [fakeTool('their_tool')], hooks: [fakeHook('their_hook')] });

    mine.disarm();

    expect(shared.tools.map((tool) => tool.name)).toEqual(['own_tool', 'their_tool']);
    expect(shared.taskTools).toEqual([]);
    expect(shared.hooks.map((hook) => hook.name)).toEqual(['their_hook']);
  });

  it('frees a revoked name, so another extension can share it afterwards', async () => {
    const failing = sharer({
      name: 'failing',
      share: ghost,
      then: () => {
        throw new Error('activate failed after share');
      },
    });
    const next = sharer({ name: 'next', share: { tool: 'next_tool', hook: 'next_hook' } });
    const run = await activateAgents({ extras: [failing.extension, next.extension] });

    expect(run.result.failed.map((failure) => failure.extension)).toEqual(['failing']);

    next.held.scope!.share({ tools: [fakeTool('ghost_tool')], hooks: [fakeHook('ghost_hook')] });

    const { tools, hooks } = await startedWith(run);

    expect(tools.map((tool) => tool.name)).toContain('ghost_tool');
    expect(hooks.map((hook) => hook.name)).toContain('ghost_hook');
  });

  it('leaves a sub-agent that is already running with what it was given', async () => {
    const mine = sharer({ name: 'mine', share: { tool: 'mine_tool', hook: 'mine_hook' } });
    const run = await activateAgents({ extras: [mine.extension] });
    const running = await startedWith(run);

    await run.host.deactivate();

    expect(running.tools.map((tool) => tool.name)).toContain('mine_tool');
    expect(running.hooks.map((hook) => hook.name)).toEqual(['mine_hook']);
  });
});
