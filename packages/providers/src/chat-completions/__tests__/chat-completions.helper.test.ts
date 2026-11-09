import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { Message } from '@sheavly/protocol/message/message.types';
import { createChatCompletionsProvider } from '../chat-completions.helper.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';

const url = 'https://resource.test/models/chat/completions?api-version=2024-05-01-preview';
const source = `chat:${url}#deployment`;
const chunk = (delta: object, finish_reason: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason }],
});

function setup(
  responses: object[][],
  options: { replayReasoning?: boolean; thinkingMode?: 'enabled' | 'disabled' } = {},
) {
  const fake = fakeFetchSequence({ responses, complete: false });
  const provider = createChatCompletionsProvider({
    endpoint: { url, model: 'deployment', headers: { 'api-key': 'private' } },
    fetch: fake.fetch,
    request: TEST_REQUEST,
    maxTokens: 512,
    replayReasoning: true,
    ...options,
  });

  return { ...fake, provider };
}

const request = (messages: Message[] = [{ role: 'user', content: 'hello' }]) => ({
  instructions: 'system instructions',
  messages,
  tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
  signal: new AbortController().signal,
});

describe('native Chat Completions', () => {
  it('sends the request notice as a last user message, after the history', async () => {
    const { provider, requests } = setup([
      [chunk({ content: 'ok' }, 'stop')],
      [chunk({ content: 'ok' }, 'stop')],
    ]);
    const notice: HarnessNotice = { kind: 'context-usage', context: { window: 5 } };
    const sent = { ...request(), notice };
    const original = structuredClone(sent.messages);

    await collect(provider.stream(sent));
    await collect(provider.stream(request()));
    expect(requests[0]?.body.messages).toEqual([
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'hello' },
      { role: 'user', content: formatHarnessNotice(notice) },
    ]);
    expect(requests[1]?.body.messages).toEqual([
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'hello' },
    ]);
    expect(sent.messages).toEqual(original);
  });

  it('accepts Azure text and usage frames with nullable optional fields', async () => {
    const { provider } = setup([
      [
        chunk({ content: 'ok', tool_calls: null }, 'stop'),
        {
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: null },
        },
      ],
    ]);

    expect(await collect(provider.stream(request()))).toContainEqual({
      type: 'done',
      stopReason: 'end_turn',
      usage: {
        tokens: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    });
  });
  it('uses native messages and nested function tools, streams text and retains final usage', async () => {
    const { provider, requests } = setup([
      [
        chunk({ content: 'hel' }),
        chunk({ content: 'lo' }, 'stop'),
        {
          choices: [],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 8 },
          },
        },
      ],
    ]);
    const events = await collect(provider.stream(request()));

    expect(events).toEqual([
      { type: 'text_delta', text: 'hel' },
      { type: 'text_delta', text: 'lo' },
      {
        type: 'done',
        stopReason: 'end_turn',
        usage: {
          tokens: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 0 },
        },
      },
    ]);
    expect(requests[0]?.url).toBe(url);
    expect(requests[0]?.body).toMatchObject({
      model: 'deployment',
      messages: [
        { role: 'system', content: 'system instructions' },
        { role: 'user', content: 'hello' },
      ],
      tools: [{ type: 'function', function: { name: 'echo', parameters: { type: 'object' } } }],
      max_tokens: 512,
      stream_options: { include_usage: true },
    });
    expect(requests[0]?.body).not.toHaveProperty('input');
    expect(requests[0]?.body).not.toHaveProperty('include');
  });

  it('assembles parallel fragmented tool calls by index and replays its own plain thinking', async () => {
    const { provider, requests } = setup([
      [
        chunk({
          reasoning_content: 'consider',
          tool_calls: [
            { index: 1, id: 'b', type: 'function', function: { name: 'echo', arguments: '{"v":' } },
          ],
        }),
        chunk(
          {
            reasoning_content: 'ed',
            tool_calls: [
              { index: 0, id: 'a', function: { name: 'echo', arguments: '{"v":1}' } },
              { index: 1, function: { arguments: '2}' } },
            ],
          },
          'tool_calls',
        ),
      ],
      [chunk({ content: 'done' }, 'stop')],
    ]);
    const events = await collect(provider.stream(request()));
    const thinking = events.find((event) => event.type === 'reasoning');
    const calls = events.flatMap((event) => (event.type === 'tool_call' ? [event.call] : []));

    expect(calls).toEqual([
      { id: 'a', name: 'echo', input: { v: 1 } },
      { id: 'b', name: 'echo', input: { v: 2 } },
    ]);
    expect(thinking).toEqual({
      type: 'reasoning',
      item: { source, data: { type: 'chat-reasoning', content: 'considered' } },
    });
    if (thinking?.type !== 'reasoning') throw new Error('Missing test reasoning');
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: calls,
        reasoning: [thinking.item, { source: 'responses:other', data: 'encrypted' }],
      },
      { role: 'tool', toolCallId: callIdSchema.parse('a'), content: 'one', isError: false },
    ];

    await collect(provider.stream(request(messages)));
    expect(requests[1]?.body.messages).toMatchObject([
      { role: 'system' },
      {
        role: 'assistant',
        reasoning_content: 'considered',
        tool_calls: [{ id: 'a' }, { id: 'b' }],
      },
      { role: 'tool', tool_call_id: 'a', content: 'one' },
    ]);
    expect(JSON.stringify(requests[1]?.body)).not.toContain('encrypted');
  });

  it('does not execute unfinished calls on output truncation and leaves malformed JSON to tool validation', async () => {
    const limited = setup([
      [chunk({ tool_calls: [{ index: 0, function: { arguments: '{' } }] }, 'length')],
    ]);

    expect(await collect(limited.provider.stream(request()))).toEqual([
      { type: 'done', stopReason: 'max_tokens' },
    ]);
    const malformed = setup([
      [
        chunk(
          { tool_calls: [{ index: 0, id: 'a', function: { name: 'echo', arguments: '{broken' } }] },
          'tool_calls',
        ),
      ],
    ]);

    expect(await collect(malformed.provider.stream(request()))).toContainEqual({
      type: 'tool_call',
      call: { id: 'a', name: 'echo', input: '{broken' },
    });
  });

  it('fails closed on cut-off replies, incomplete calls, invalid usage and stream errors', async () => {
    for (const response of [
      [chunk({ content: 'unfinished' })],
      [
        chunk(
          { tool_calls: [{ index: 0, function: { name: 'echo', arguments: '{}' } }] },
          'tool_calls',
        ),
      ],
      [
        {
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 2, prompt_cache_hit_tokens: 3 },
        },
      ],
      [{ error: { message: 'raw private error' } }],
    ]) {
      const { provider } = setup([response]);

      await expect(collect(provider.stream(request()))).rejects.toThrow();
    }
  });

  it('omits replay when disabled and forwards explicit thinking mode without a conflicting effort', async () => {
    const { provider, requests } = setup([[chunk({ content: 'ok' }, 'stop')]], {
      replayReasoning: false,
      thinkingMode: 'disabled',
    });
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'previous',
        toolCalls: [],
        reasoning: [{ source, data: 'invalid unused state' }],
      },
    ];

    await collect(provider.stream({ ...request(messages), mode: 'high' }));
    expect(requests[0]?.body).toMatchObject({ thinking: { type: 'disabled' } });
    expect(requests[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(requests[0]?.body.messages).toEqual([
      { role: 'system', content: 'system instructions' },
      { role: 'assistant', content: 'previous' },
    ]);
  });
});
