import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createMessagesProvider } from '../messages.helper.js';
import { toMessagesApiMessages } from '../input.utils.js';
import { messagesPrefix } from '../prefix.utils.js';
import { createMessagesReader } from '../events.utils.js';
import { messagesEventSchema } from '../messages.validator.js';
import type { MessagesReplay } from '../messages.types.js';

const source = 'messages:https://example.test/v1#claude';
const call = {
  id: callIdSchema.parse('lookup-1'),
  name: 'lookup',
  input: { description: 'Lookup' },
};
const user: Message = { role: 'user', content: 'Go' };
const content: MessagesReplay['content'] = [
  { type: 'thinking', thinking: '', signature: 'first' },
  { type: 'text', text: 'One' },
  { type: 'tool_use', ...call },
  { type: 'redacted_thinking', data: 'encrypted' },
  { type: 'text', text: 'Two' },
  { type: 'thinking', thinking: 'Progress', signature: 'second' },
];
const prefix = messagesPrefix({
  instructions: 'Fixed',
  tools: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Go' }] }],
});
const assistant: Message = {
  role: 'assistant',
  content: 'OneTwo',
  toolCalls: [call],
  reasoning: [{ source, data: { type: 'messages-replay', prefix, content } }],
};
const translate = (
  params: { instructions?: string; tools?: Record<string, unknown>[]; messages?: Message[] } = {},
) =>
  toMessagesApiMessages({
    reasoningSource: source,
    instructions: params.instructions ?? 'Fixed',
    tools: params.tools ?? [],
    messages: params.messages ?? [user, assistant],
  });

describe('signed Messages replay', () => {
  it('refuses unfinished or unsigned thinking instead of storing poisoned replay state', () => {
    const reader = createMessagesReader({ reasoningSource: source, prefix, notices: [] });

    reader.read(
      messagesEventSchema.parse({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking' },
      }),
    );

    expect(() => reader.read({ type: 'message_stop' })).toThrow('unfinished content blocks');
    expect(() => reader.read({ type: 'content_block_stop', index: 0 })).toThrow(
      'without its signature',
    );
  });
  it('honors edits to assistant text or tool input instead of its stale replay state', () => {
    const changed: Message = { ...assistant, content: 'Edited' };

    expect(translate({ messages: [user, changed] })[1]?.content).toEqual([
      { type: 'text', text: 'Edited' },
      { type: 'tool_use', ...call },
    ]);
  });
  it('retains interleaved block order and text boundaries through JSON persistence', () => {
    const messages = JSON.parse(JSON.stringify([user, assistant])) as Message[];

    expect(translate({ messages })[1]?.content).toEqual(content);
  });

  it.each([
    { instructions: 'Changed' },
    { tools: [{ name: 'new-tool' }] },
    { messages: [{ ...user, content: 'Changed' }, assistant] },
  ])('drops invalid thinking, not text or tool calls, after a prefix edit: %j', (change) => {
    expect(translate(change)[1]?.content).toEqual(
      content.filter((block) => block.type === 'text' || block.type === 'tool_use'),
    );
    expect(assistant.reasoning).toHaveLength(1);
  });

  it('leaves legacy signatures out, retaining descriptions and tool inputs', () => {
    expect(
      translate({
        messages: [
          user,
          {
            ...assistant,
            reasoning: [{ source, data: { type: 'thinking', thinking: '', signature: 'legacy' } }],
          },
        ],
      })[1]?.content,
    ).toEqual([
      { type: 'text', text: 'OneTwo' },
      { type: 'tool_use', ...call },
    ]);
  });

  it('keeps fresh thinking after a recovery boundary, without restoring older signatures', () => {
    const recovered = translate({ instructions: 'Changed' });
    const freshContent = [{ type: 'thinking', thinking: '', signature: 'fresh' }];
    const messages: Message[] = [user, assistant, { role: 'user', content: 'Continue' }];
    const preceding = [
      ...recovered,
      { role: 'user' as const, content: [{ type: 'text', text: 'Continue' }] },
    ];

    messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [],
      reasoning: [
        {
          source,
          data: {
            type: 'messages-replay',
            prefix: messagesPrefix({ instructions: 'Changed', tools: [], messages: preceding }),
            content: freshContent,
          },
        },
      ],
    });

    expect(translate({ instructions: 'Changed', messages }).at(-1)?.content).toEqual(freshContent);
    expect(translate({ instructions: 'Changed', messages })[1]?.content).toEqual(
      recovered[1]?.content,
    );
  });

  it('captures the streamed reply in its original order for the next call', async () => {
    const response = content.flatMap<object>((block, index) => {
      if (block.type === 'redacted_thinking') {
        return [
          { type: 'content_block_start', index, content_block: block },
          { type: 'content_block_stop', index },
        ];
      }

      let delta: object;

      if (block.type === 'text') delta = { type: 'text_delta', text: block.text };
      else if (block.type === 'tool_use') {
        delta = { type: 'input_json_delta', partial_json: JSON.stringify(block.input) };
      } else delta = { type: 'signature_delta', signature: block.signature };

      return [
        {
          type: 'content_block_start',
          index,
          content_block: { ...block, text: '', thinking: '', signature: '' },
        },
        { type: 'content_block_delta', index, delta },
        { type: 'content_block_stop', index },
      ];
    });
    const { fetch, requests } = fakeFetchSequence({
      responses: [[...response, { type: 'message_stop' }], [{ type: 'message_stop' }]],
      complete: false,
    });
    const provider = createMessagesProvider({
      endpoint: { baseUrl: 'https://example.test/v1', model: 'claude', headers: {} },
      maxTokens: 4096,
      thinkingMode: 'adaptive',
      request: TEST_REQUEST,
      fetch,
    });
    const events = await collect(
      provider.stream(providerRequest({ instructions: 'Fixed', messages: [user] })),
    );
    const reasoning = events.flatMap((event) => (event.type === 'reasoning' ? [event.item] : []));

    await collect(
      provider.stream(
        providerRequest({ instructions: 'Fixed', messages: [user, { ...assistant, reasoning }] }),
      ),
    );

    expect(requests[1]?.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Go' }] },
      {
        role: 'assistant',
        content: content.map((block) =>
          block.type === 'thinking' ? { ...block, thinking: '' } : block,
        ),
      },
    ]);
  });
});
