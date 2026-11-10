import { describe, expect, it } from 'vitest';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { z } from 'zod';
import { runSession } from '../stream-agent.helper.js';

/** A provider that records every request, calling a tool on its first `toolTurns` turns. */
function recordingProvider(toolTurns: number) {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    async *stream(request) {
      await Promise.resolve();
      requests.push({ ...request, messages: structuredClone(request.messages) });

      if (requests.length <= toolTurns) {
        const id = callIdSchema.parse(`c${String(requests.length)}`);

        yield { type: 'tool_call', call: { id, name: 'lookup', input: {} } };
        yield { type: 'done', stopReason: 'tool_use' };

        return;
      }

      yield { type: 'text_delta', text: 'done' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };

  return { provider, requests };
}

const lookup = defineTool({
  name: 'lookup',
  description: 'Looks something up',
  inputSchema: z.object({}),
  execute: async () => 'found',
});

describe('the prompt prefix between turns', () => {
  it('sends the same cache key, instructions, tools and earlier messages on every turn', async () => {
    const { provider, requests } = recordingProvider(2);
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });

    await runSession({
      provider,
      tools: [lookup],
      instructions: 'Use npm.',
      messages: [{ role: 'user', content: 'hi' }],
      session: { registry, ref },
    });

    expect(requests).toHaveLength(3);
    expect(new Set(requests.map((request) => request.cacheKey))).toEqual(new Set([ref.id]));

    for (const [index, request] of requests.entries()) {
      const before = requests[index - 1];

      if (!before) continue;

      expect(request.instructions).toBe(before.instructions);
      expect(JSON.stringify(request.tools)).toBe(JSON.stringify(before.tools));
      expect(JSON.stringify(request.messages.slice(0, before.messages.length))).toBe(
        JSON.stringify(before.messages),
      );
    }
  });

  it('keeps earlier bytes when a hook adds per-turn context, which only appends', async () => {
    const { provider, requests } = recordingProvider(1);
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const rules = defineHook({
      name: 'rules',
      beforeTurn: async ({ addInstructions }) => addInstructions('Standing rule.'),
    });

    await runSession({
      provider,
      tools: [lookup],
      hooks: [rules],
      messages: [{ role: 'user', content: 'hi' }],
      session: { registry, ref },
    });

    const [first, second] = requests;

    expect(second?.instructions).toBe(first?.instructions);
    expect(JSON.stringify(second?.messages.slice(0, first?.messages.length))).toBe(
      JSON.stringify(first?.messages),
    );
  });

  it('keeps the same key when the session is resumed, and gives a child its own', async () => {
    const { provider, requests } = recordingProvider(0);
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const main = { provider, tools: [], session: { registry, ref }, keepSession: true as const };
    const first = await runSession({ ...main, messages: [{ role: 'user', content: 'hi' }] });

    registry.resume(ref.id);
    await runSession({
      ...main,
      messages: [...first.messages, { role: 'user', content: 'again' }],
      resumed: true,
    });

    // Only a running session starts sub-agents.
    registry.resume(ref.id);

    const child = registry.startChild({
      parentId: ref.id,
      startedByCall: callIdSchema.parse('spawn'),
      title: 'Helper',
    });

    await runSession({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'help' }],
      session: { registry, ref: child },
    });

    expect(requests.map((request) => request.cacheKey)).toEqual([ref.id, ref.id, child.id]);
    expect(child.id).not.toBe(ref.id);
  });
});
