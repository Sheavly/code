import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scriptedProvider } from '../../../testing/scripted-provider.fake.js';
import { defineHook } from '@sheavly/core/hook/hook.service';
import { defineTool } from '@sheavly/core/tool/tool.service';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { runAgent } from '../stream-agent.service.js';
import type { AgentEvent } from '../../events/events.types.js';

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

  it('runs hooks in the loop: context before each turn, every tool call wrapped', async () => {
    const call = {
      id: '1',
      name: 'get_weather',
      input: { description: 'checking Oslo weather', city: 'Oslo' },
    };
    const provider = scriptedProvider([
      [
        { type: 'tool_call', call },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'done', stopReason: 'end_turn' }],
    ]);
    const hooks = [
      defineHook({
        name: 'clock',
        beforeTurn: async ({ turn, addContext }) => addContext(`<turn>${turn}</turn>`),
      }),
      defineHook({
        name: 'audit',
        aroundToolCall: async ({ next }) => {
          const result = await next();

          return { ...result, content: `${result.content} (audited)` };
        },
      }),
    ];

    const events: AgentEvent[] = [];
    const messages = await runAgent({
      provider,
      tools: [getWeather],
      messages: [{ role: 'user', content: 'Weather in Oslo?' }],
      hooks,
      onEvent: (e) => events.push(e),
    });

    expect(messages).toEqual([
      { role: 'user', content: 'Weather in Oslo?' },
      { role: 'user', content: '<turn>1</turn>' },
      { role: 'assistant', content: '', toolCalls: [call] },
      { role: 'tool', toolCallId: '1', content: 'Sunny in Oslo (audited)', isError: false },
      { role: 'user', content: '<turn>2</turn>' },
      { role: 'assistant', content: '', toolCalls: [] },
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'context_added',
      'tool_call_started',
      'turn_end',
      'tool_batch',
      'tool_result',
      'context_added',
      'turn_end',
      'done',
    ]);
    expect(events[0]).toMatchObject({ hook: 'clock', content: '<turn>1</turn>' });
  });
});
