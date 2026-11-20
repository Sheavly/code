import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { DuplicateToolError } from '../../errors/loop.errors.js';
import { runAgent } from '../stream-agent.helper.js';
import { toolTurn, say } from '../../testing/work-kinds.fake.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';

const prompt = { role: 'user' as const, content: 'hi' };

const toolNamed = (name: string, answer = name) =>
  defineTool({
    name,
    description: `The ${name} tool`,
    inputSchema: z.object({}),
    execute: async () => answer,
  });

/** A provider that counts the model calls it is asked for. */
function countingProvider(calls: { count: number }): Provider {
  return {
    async *stream() {
      calls.count += 1;
      yield* say('ok');
    },
  };
}

/**
 * A provider that records the tool names each model call is sent. Turn 1 calls tool `a`, turn 2
 * answers; `onTurn` runs at the start of each call.
 */
function recordingProvider(params: { seen: string[][]; onTurn: (turn: number) => void }): Provider {
  let turn = 0;

  return {
    async *stream(request) {
      turn += 1;
      params.seen.push(request.tools.map((tool) => tool.name));
      params.onTurn(turn);
      yield* turn === 1 ? toolTurn({ id: 'c1', name: 'a', input: {} }) : say('ok');
    },
  };
}

/** Runs and returns what the failed run threw, with its events and the model calls made. */
async function failedRun(tools: ReturnType<typeof toolNamed>[], hooks = defineHooks()) {
  const calls = { count: 0 };
  const events: AgentEvent[] = [];
  const thrown = await runAgent({
    provider: countingProvider(calls),
    tools,
    messages: [prompt],
    hooks,
    onEvent: (event) => events.push(event),
  }).catch((caughtError: unknown) => caughtError);

  return { calls, events, thrown };
}

function defineHooks(log: string[] = []) {
  return [defineHook({ name: 'watch', onError: async () => void log.push('onError') })];
}

describe('tool names are unique within a run', () => {
  it('fails a run with two tools of one name before the first model call, naming the tool', async () => {
    const log: string[] = [];
    const { calls, events, thrown } = await failedRun(
      [toolNamed('read'), toolNamed('read')],
      defineHooks(log),
    );

    expect(thrown).toBeInstanceOf(DuplicateToolError);
    expect(thrown).toMatchObject({ tool: 'read', count: 2 });
    expect((thrown as Error).message).toBe(
      'Tool read is listed 2 times: tool names must be unique within a run',
    );
    expect(calls.count).toBe(0);
    // Like a miswired hook: run_failed, then the run's one done; the onError hooks ran.
    expect(events.map((event) => event.type)).toEqual(['run_failed', 'done']);
    expect(events[0]).toMatchObject({ type: 'run_failed' });
    expect((events[0] as { error: string }).error).toContain('Tool read is listed 2 times');
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'failed' });
    expect(log).toEqual(['onError']);
  });

  it('names the shared tool when only two of three tools clash', async () => {
    const { thrown, calls } = await failedRun([
      toolNamed('alpha'),
      toolNamed('beta'),
      toolNamed('beta'),
    ]);

    expect(thrown).toMatchObject({ name: 'DuplicateToolError', tool: 'beta', count: 2 });
    expect(calls.count).toBe(0);
  });

  it('counts every copy of a name', async () => {
    const { thrown } = await failedRun([toolNamed('x'), toolNamed('x'), toolNamed('x')]);

    expect(thrown).toMatchObject({ tool: 'x', count: 3 });
  });

  it('counts the same tool object listed twice as a duplicate', async () => {
    const once = toolNamed('same');
    const { thrown, calls } = await failedRun([once, once]);

    expect(thrown).toMatchObject({ tool: 'same', count: 2 });
    expect(calls.count).toBe(0);
  });

  it('fails before any sessionStart hook runs', async () => {
    const started: string[] = [];

    await expect(
      runAgent({
        provider: countingProvider({ count: 0 }),
        tools: [toolNamed('a'), toolNamed('a')],
        messages: [prompt],
        hooks: [defineHook({ name: 'start', sessionStart: async () => void started.push('ran') })],
      }),
    ).rejects.toBeInstanceOf(DuplicateToolError);
    expect(started).toEqual([]);
  });

  it('reads a live tools getter once and goes on with that list', async () => {
    const seen: string[][] = [];
    let reads = 0;

    // Read 1 is clean, any later read is a duplicate: a run that read the list again would fail
    // or send the model the duplicate.
    await runAgent({
      provider: recordingProvider({ seen, onTurn: () => undefined }),
      get tools() {
        reads += 1;

        return reads === 1 ? [toolNamed('a')] : [toolNamed('a'), toolNamed('a')];
      },
      messages: [prompt],
    });

    expect(reads).toBe(1);
    expect(seen).toEqual([['a'], ['a']]);
  });

  it('goes on with a copy: a duplicate pushed into the original list mid-run changes nothing', async () => {
    const seen: string[][] = [];
    const original = [toolNamed('a', 'first')];

    const messages = await runAgent({
      provider: recordingProvider({
        seen,
        // A holder of the caller's array adds a duplicate, first in line, during turn 1.
        onTurn: (turn) => {
          if (turn === 1) original.unshift(toolNamed('a', 'second'));
        },
      }),
      tools: original,
      messages: [prompt],
    });

    expect(original).toHaveLength(2);
    expect(seen).toEqual([['a'], ['a']]);
    expect(JSON.stringify(messages)).toContain('first');
    expect(JSON.stringify(messages)).not.toContain('second');
  });

  it('runs a normal turn with distinct tools', async () => {
    const messages = await runAgent({
      provider: scriptedProvider([toolTurn({ id: 'c1', name: 'beta', input: {} }), say('done')]),
      tools: [toolNamed('alpha'), toolNamed('beta', 'beta ran')],
      messages: [prompt],
    });

    expect(JSON.stringify(messages)).toContain('beta ran');
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'done' });
  });

  it('allows an empty list and a single tool', async () => {
    for (const tools of [[], [toolNamed('only')]]) {
      const { thrown, calls } = await failedRun(tools);

      expect(thrown).not.toBeInstanceOf(DuplicateToolError);
      expect(calls.count).toBe(1);
    }
  });

  it('compares names exactly: two names differing only in case are two tools', async () => {
    const { thrown, calls } = await failedRun([toolNamed('Read'), toolNamed('read')]);

    expect(thrown).not.toBeInstanceOf(DuplicateToolError);
    expect(calls.count).toBe(1);
  });
});
