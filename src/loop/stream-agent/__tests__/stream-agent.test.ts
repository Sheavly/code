import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callOnceProvider, scriptedProvider } from '../../../testing/scripted-provider.fake.js';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { runAgent } from '../stream-agent.helper.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';

const getWeather = defineTool({
  name: 'get_weather',
  description: 'Get the weather for a city',
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ input: { city } }) => `Sunny in ${city}`,
});

describe('runAgent', () => {
  it('stops after one turn when the model calls no tools', async () => {
    const provider = scriptedProvider([
      [
        { type: 'text_delta', text: 'Hello' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);

    const messages = await runAgent({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello', toolCalls: [] },
    ]);
  });

  it('runs a tool and feeds the result back to the model', async () => {
    const call = {
      id: '1',
      name: 'get_weather',
      input: { description: 'checking Stockholm weather', city: 'Stockholm' },
    };
    const provider = scriptedProvider([
      [
        { type: 'tool_call', call },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: "It's sunny." },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);

    const events: AgentEvent[] = [];
    const messages = await runAgent({
      provider,
      tools: [getWeather],
      messages: [{ role: 'user', content: 'Weather in Stockholm?' }],
      onEvent: (e) => events.push(e),
    });

    expect(messages).toEqual([
      { role: 'user', content: 'Weather in Stockholm?' },
      { role: 'assistant', content: '', toolCalls: [call] },
      { role: 'tool', toolCallId: '1', content: 'Sunny in Stockholm', isError: false },
      { role: 'assistant', content: "It's sunny.", toolCalls: [] },
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'tool_call_started',
      'turn_end',
      'tool_batch',
      'tool_result',
      'text_delta',
      'turn_end',
      'done',
    ]);
    expect(events[0]).toMatchObject({
      type: 'tool_call_started',
      description: 'checking Stockholm weather',
    });
  });

  it('returns a validation error to the model instead of crashing', async () => {
    const provider = scriptedProvider([
      [
        {
          type: 'tool_call',
          call: { id: '1', name: 'get_weather', input: { description: '?', city: 42 } },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'done', stopReason: 'end_turn' }],
    ]);

    const messages = await runAgent({
      provider,
      tools: [getWeather],
      messages: [{ role: 'user', content: '?' }],
    });

    expect(messages[2]).toMatchObject({ role: 'tool', isError: true });
  });

  it('stops at maxTurns', async () => {
    const loopForever: StreamEvent[] = [
      {
        type: 'tool_call',
        call: { id: '1', name: 'get_weather', input: { description: 'again', city: 'X' } },
      },
      { type: 'done', stopReason: 'tool_use' },
    ];
    const provider = scriptedProvider([loopForever, loopForever, loopForever]);

    const messages = await runAgent({
      provider,
      tools: [getWeather],
      messages: [{ role: 'user', content: '?' }],
      maxTurns: 2,
    });

    // user + 2 × (assistant + tool)
    expect(messages).toHaveLength(5);
  });

  it("puts a tool's artifacts on tool_result unchanged, never in the model's history", async () => {
    const artifacts = [{ kind: 'table', columns: ['a', 'b'], rows: [[1, 2]] }];
    const parser = defineTool({
      name: 'parser',
      description: 'Parses a file',
      inputSchema: z.object({}),
      execute: async () => ({ content: 'Parsed 1 row', artifacts }),
    });
    const call = { id: '1', name: 'parser', input: { description: 'parsing a.csv' } };
    const events: AgentEvent[] = [];
    const messages = await runAgent({
      provider: callOnceProvider(call),
      tools: [parser],
      messages: [{ role: 'user', content: 'parse' }],
      onEvent: (e) => events.push(e),
    });

    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ artifacts });
    expect(JSON.stringify(messages)).not.toContain('columns');
    expect(messages[2]).toEqual({
      role: 'tool',
      toolCallId: '1',
      content: 'Parsed 1 row',
      isError: false,
    });
  });
});
