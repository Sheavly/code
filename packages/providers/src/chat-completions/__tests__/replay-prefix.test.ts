import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { chatCall, chatFrame, chatTransport } from '../../testing/chat-completions.fake.js';

function assistantFrom(events: StreamEvent[]): Extract<Message, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: events.flatMap((event) => (event.type === 'text_delta' ? [event.text] : [])).join(''),
    toolCalls: events.flatMap((event) => (event.type === 'tool_call' ? [event.call] : [])),
    reasoning: events.flatMap((event) => (event.type === 'reasoning' ? [event.item] : [])),
  };
}

function toolReply(id: string, index: number) {
  return [
    chatFrame({ delta: { reasoning_content: `Step ${index}: ` } }),
    chatFrame({
      delta: {
        reasoning_content: 'inspect',
        tool_calls: [{ index: 0, id, function: { name: 'inspect', arguments: '{}' } }],
      },
      finish: 'tool_calls',
    }),
  ];
}

describe('Chat replay and automatic cache request prefixes', () => {
  it('retains all reasoning through parallel tools, another tool turn, a final answer and a new user turn', async () => {
    const first = toolReply('a', 1);

    first.splice(
      1,
      0,
      chatFrame({
        delta: {
          tool_calls: [
            { index: 1, id: 'b', function: { name: 'inspect', arguments: '{"item":2}' } },
          ],
        },
      }),
    );
    const { provider, requests } = chatTransport({
      responses: [
        first,
        toolReply('c', 2),
        [
          chatFrame({ delta: { reasoning_content: 'Ready to answer' } }),
          chatFrame({ delta: { content: 'Both inspected' }, finish: 'stop' }),
        ],
        [chatFrame({ delta: { content: 'Next answer' }, finish: 'stop' })],
      ],
      config: { effortProfile: 'deepseek', thinkingMode: 'enabled', replayReasoning: true },
    });
    const history = chatCall().messages;
    const seen: Extract<Message, { role: 'assistant' }>[] = [];

    for (let turn = 0; turn < 4; turn++) {
      const notice: HarnessNotice = { kind: 'context-usage', context: { window: 100 + turn } };
      const snapshot = structuredClone(history);
      const events = await collect(
        provider.stream(chatCall({ messages: history, notices: [notice] })),
      );

      expect(history).toEqual(snapshot);
      expect(requests[turn]?.body.messages).toEqual(
        expect.arrayContaining([{ role: 'user', content: formatHarnessNotice(notice) }]),
      );
      const assistant = assistantFrom(events);

      seen.push(assistant);
      history.push(assistant);

      for (const call of assistant.toolCalls) {
        history.push({
          role: 'tool',
          toolCallId: call.id,
          content: `Result ${call.id}`,
          isError: false,
        });
      }

      if (turn === 2) history.push({ role: 'user', content: 'Now inspect the next pair' });
    }

    expect(seen[0]?.toolCalls.map((call) => call.id)).toEqual(['a', 'b']);
    expect(seen[1]?.toolCalls.map((call) => call.id)).toEqual(['c']);
    expect(seen[2]?.toolCalls).toEqual([]);
    expect(seen[2]?.content).toBe('Both inspected');
    const finalMessages = requests[3]?.body.messages as Record<string, unknown>[];

    expect(finalMessages.filter((message) => message.role === 'assistant')).toMatchObject([
      { reasoning_content: 'Step 1: inspect', tool_calls: [{ id: 'a' }, { id: 'b' }] },
      { reasoning_content: 'Step 2: inspect', tool_calls: [{ id: 'c' }] },
      { reasoning_content: 'Ready to answer', content: 'Both inspected' },
    ]);
    expect(finalMessages.at(-2)).toEqual({ role: 'user', content: 'Now inspect the next pair' });

    // Notices vary outside retained history; this checks reusable bytes, not a live cache hit.
    for (let turn = 1; turn < requests.length; turn++) {
      const previous = requests[turn - 1]?.body.messages as Record<string, unknown>[];
      const current = requests[turn]?.body.messages as Record<string, unknown>[];
      const retained = previous.slice(0, -1);

      expect(JSON.stringify(current.slice(0, retained.length))).toBe(JSON.stringify(retained));
      expect(requests[turn]?.body.tools).toEqual(requests[0]?.body.tools);
    }

    for (const { body } of requests) {
      expect(body).not.toHaveProperty('cache_control');
      expect(body).not.toHaveProperty('prompt_cache_key');
      expect(body).not.toHaveProperty('prompt_cache_options');
      expect(JSON.stringify(body)).not.toContain('prompt_cache_breakpoint');
    }
  });

  it('excludes foreign endpoints, API versions, models and protocols while retaining ordinary content and tools', async () => {
    const endpoint = {
      url: 'https://provenance.test/models/chat/completions?api-version=2024-05-01-preview',
      model: 'own-model',
      headers: {},
    };
    const { provider, requests } = chatTransport({
      responses: [toolReply('own', 1), [chatFrame({ finish: 'stop' })]],
      config: { endpoint, replayReasoning: true },
    });
    const own = assistantFrom(await collect(provider.stream(chatCall())));
    const ownSource = `chat:${endpoint.url}#${endpoint.model}`;
    const foreignSources = [
      'chat:https://elsewhere.test/models/chat/completions?api-version=2024-05-01-preview#own-model',
      'chat:https://provenance.test/models/chat/completions?api-version=2025-04-01-preview#own-model',
      `chat:${endpoint.url}#other-model`,
      `responses:${endpoint.url}#own-model`,
      `anthropic:${endpoint.url}#own-model`,
    ];

    expect(own.reasoning?.[0]?.source).toBe(ownSource);
    own.reasoning?.push(
      ...foreignSources.map((source) => ({ source, data: 'invalid foreign secret' })),
    );
    const foreignOnly: Message = {
      role: 'assistant',
      content: 'Ordinary foreign answer',
      toolCalls: [],
      reasoning: foreignSources.map((source) => ({ source, data: 'invalid foreign secret' })),
    };
    const messages = [foreignOnly, own];
    const snapshot = structuredClone(messages);

    await collect(provider.stream(chatCall({ messages })));
    expect(messages).toEqual(snapshot);
    expect(requests[1]?.body.messages).toMatchObject([
      { role: 'system' },
      { role: 'assistant', content: 'Ordinary foreign answer', reasoning_content: '' },
      { role: 'assistant', reasoning_content: 'Step 1: inspect', tool_calls: [{ id: 'own' }] },
    ]);
    expect(JSON.stringify(requests[1]?.body)).not.toContain('invalid foreign secret');
  });

  it('replay disabled neither emits nor parses reasoning while retaining text and tool calls', async () => {
    const { provider, requests } = chatTransport({
      responses: [toolReply('a', 1)],
      config: { replayReasoning: false, thinkingMode: 'disabled', effortProfile: 'deepseek' },
    });
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'Saved answer',
        toolCalls: [],
        reasoning: [
          {
            source:
              'chat:https://chat.test/models/chat/completions?api-version=2024-05-01-preview#custom-deployment',
            data: 'invalid own state not used',
          },
        ],
      },
    ];
    const events = await collect(provider.stream(chatCall({ messages, mode: 'extreme' })));

    expect(events.some((event) => event.type === 'reasoning')).toBe(false);
    expect(events).toContainEqual({
      type: 'tool_call',
      call: { id: 'a', name: 'inspect', input: {} },
    });
    expect(requests[0]?.body.messages).toEqual([
      { role: 'system', content: 'Stable instructions' },
      { role: 'assistant', content: 'Saved answer' },
    ]);
    expect(requests[0]?.body).not.toHaveProperty('reasoning_effort');
  });
});
