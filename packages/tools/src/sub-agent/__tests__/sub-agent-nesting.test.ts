import { describe, expect, it, vi } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import type { Tool } from '@sheavly/core/tool/tool.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { z } from 'zod';
import { registryScopes } from '../../testing/registry-scopes.fake.js';
import type { RunWithRegistries } from '../../testing/registry-scopes.types.js';
import { createSubAgentTool } from '../sub-agent.tool.js';

/** The runs are mocked, so the provider is never streamed from. */
const provider: Provider = { stream: vi.fn<Provider['stream']>() };

type Options = Parameters<typeof createSubAgentTool>[0];
type Run = Parameters<RunWithRegistries>[0];

const shared = (name: string) =>
  defineTool({
    name,
    description: name,
    inputSchema: z.object({}),
    execute: async () => 'ok',
  });

const call = (params: {
  id: string;
  tools: Tool[];
  session: Parameters<typeof runTool>[0]['session'];
}) =>
  runTool({
    tools: params.tools,
    call: {
      id: callIdSchema.parse(params.id),
      name: 'start_agent',
      input: { description: 'd', title: 'Work', task: 'Do it.' },
    },
    signal: new AbortController().signal,
    session: params.session,
  });

/**
 * Starts a sub-agent from `options` and keeps it running, runs `between` (what the test changes
 * while it runs), has that sub-agent start a nested one, and hands both runs to `check`.
 */
async function nest(params: {
  options: (scopes: ReturnType<typeof registryScopes>) => Options;
  between?: () => void;
  check: (runs: { running: Run; nested: Run }) => void;
}): Promise<void> {
  const tasks = new TaskRegistry();
  const sessions = new SessionRegistry();
  const main = sessions.startMain({ title: 'Main' });
  const finish = Promise.withResolvers<Awaited<ReturnType<RunWithRegistries>>>();
  const runAgent = vi.fn<RunWithRegistries>(async () => {
    // The first sub-agent stays running until the test lets it end; the nested one ends at once.
    if (runAgent.mock.calls.length === 1) return finish.promise;

    return { reason: 'completed', messages: [] };
  });
  const options = params.options(registryScopes({ sessions, tasks, runAgent }));

  await call({ id: 'outer', tools: [createSubAgentTool(options)], session: main });

  const running = runAgent.mock.calls[0]![0];

  params.between?.();

  try {
    await call({ id: 'inner', tools: running.tools, session: running.session.ref });
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2));
    params.check({ running, nested: runAgent.mock.calls[1]![0] });
  } finally {
    finish.resolve({ reason: 'completed', messages: [] });
    await tasks.cancelAll();
  }
}

describe('start_agent sharing at its own call', () => {
  it('lets a running sub-agent keep what it was given, and a nested one it starts later see only what is still shared', async () => {
    const sharedTools: Tool[] = [shared('kept'), shared('revoked')];
    const sharedHooks = [defineHook({ name: 'revoked_hook', sessionStart: async () => undefined })];

    await nest({
      options: (scopes) => ({
        scopes,
        provider,
        get tools() {
          return [...sharedTools];
        },
        get hooks() {
          return [...sharedHooks];
        },
      }),
      between: () => {
        sharedTools.splice(1, 1);
        sharedHooks.length = 0;
      },
      check: ({ running, nested }) => {
        expect(running.tools.map((tool) => tool.name)).toContain('revoked');
        expect(running.hooks.map((hook) => hook.name)).toEqual(['revoked_hook']);
        expect(nested.tools.map((tool) => tool.name)).toContain('kept');
        expect(nested.tools.map((tool) => tool.name)).not.toContain('revoked');
        expect(nested.hooks).toEqual([]);
      },
    });
  });

  it('starts a nested sub-agent from options the caller froze, as it did when the options were spread', async () => {
    await nest({
      options: (scopes) =>
        Object.freeze({ scopes, provider, tools: Object.freeze([shared('kept')]) as Tool[] }),
      check: ({ nested }) => {
        expect(nested.tools.map((tool) => tool.name)).toContain('kept');
      },
    });
  });
});
