import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createMessagesProvider } from '../messages.helper.js';

const c1 = callIdSchema.parse('c1');
const request = providerRequest;

/** A fetch whose replies are these Messages events, sent as they are (no Responses terminal event). */
const replies = (...responses: object[][]) => fakeFetchSequence({ responses, complete: false });

const provider = (params: { fetch: typeof globalThis.fetch; thinkingBudget?: number }) =>
  createMessagesProvider({
    endpoint: { baseUrl: 'https://example.test/anthropic/v1', model: 'claude', headers: {} },
    maxTokens: 4096,
    thinkingBudget: params.thinkingBudget,
    request: TEST_REQUEST,
    fetch: params.fetch,
  });

const STOP = { type: 'message_stop' };
const text = (index: number, value: string) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } },
  { type: 'content_block_stop', index },
];
const toolUse = (index: number, json: string[]) => [
  {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id: 'c1', name: 'lookup', input: {} },
  },
  ...json.map((partial_json) => ({
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json },
  })),
  { type: 'content_block_stop', index },
];
const thinking = [
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
];
const stopped = (reason: string) => ({ type: 'message_delta', delta: { stop_reason: reason } });

describe('createMessagesProvider', () => {
  it('sends the model, max_tokens, system prompt, tools and version header', async () => {
    const { fetch, requests } = replies([STOP]);

    await collect(
      provider({ fetch }).stream(
        request({
          instructions: 'Be brief.',
          tools: [{ name: 'lookup', description: 'Looks up', inputSchema: { type: 'object' } }],
        }),
      ),
    );

    expect(requests[0]?.url).toBe('https://example.test/anthropic/v1/messages');
    expect(requests[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(requests[0]?.body).toMatchObject({
      model: 'claude',
      max_tokens: 4096,
      system: 'Be brief.',
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [{ name: 'lookup', description: 'Looks up', input_schema: { type: 'object' } }],
    });
    expect(requests[0]?.body).not.toHaveProperty('thinking');
  });

  it('streams text, then a tool call with its arguments joined, and stops for tool use', async () => {
    const { fetch } = replies([
      ...text(0, 'Looking.'),
      ...toolUse(1, ['{"key":', '"x"}']),
      stopped('tool_use'),
      STOP,
    ]);

    expect(await collect(provider({ fetch }).stream(request()))).toEqual([
      { type: 'text_delta', text: 'Looking.' },
      { type: 'tool_call', call: { id: c1, name: 'lookup', input: { key: 'x' } } },
      { type: 'done', stopReason: 'tool_use' },
    ]);
  });

  it('reads a call without arguments as {}, and keeps invalid JSON raw for the tool to reject', async () => {
    const empty = await collect(
      provider({ fetch: replies([...toolUse(0, []), STOP]).fetch }).stream(request()),
    );
    const invalid = await collect(
      provider({ fetch: replies([...toolUse(0, ['{"key":']), STOP]).fetch }).stream(request()),
    );

    expect(empty[0]).toMatchObject({ call: { input: {} } });
    expect(invalid[0]).toMatchObject({ call: { input: '{"key":' } });
  });

  it('maps max_tokens, and fails on an error event or a stream cut off before message_stop', async () => {
    const capped = await collect(
      provider({ fetch: replies([stopped('max_tokens'), STOP]).fetch }).stream(request()),
    );
    const overloaded = replies([
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]);

    expect(capped.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' });
    await expect(collect(provider({ fetch: overloaded.fetch }).stream(request()))).rejects.toThrow(
      'overloaded_error: Overloaded',
    );
    await expect(
      collect(provider({ fetch: replies(text(0, 'Hal')).fetch }).stream(request())),
    ).rejects.toMatchObject({ reason: 'cut_off' });
  });

  it('joins tool results into one user message and resends its own thinking first', async () => {
    const { fetch, requests } = replies([...thinking, ...toolUse(1, ['{}']), STOP], [STOP]);
    const thinker = provider({ fetch, thinkingBudget: 2048 });
    const events = await collect(thinker.stream(request()));
    const reasoning = events.flatMap((event) => (event.type === 'reasoning' ? [event.item] : []));

    await collect(
      thinker.stream(
        request({
          messages: [
            { role: 'user', content: 'hi' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: c1, name: 'lookup', input: {} }],
              reasoning: [...reasoning, { source: 'responses:elsewhere', data: { type: 'x' } }],
            },
            { role: 'tool', toolCallId: c1, content: 'found', isError: false },
            { role: 'user', content: 'and?' },
          ],
        }),
      ),
    );

    expect(requests[0]?.body).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 2048 } });
    expect(requests[1]?.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Hmm', signature: 'sig' },
          { type: 'tool_use', id: 'c1', name: 'lookup', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'found', is_error: false },
          { type: 'text', text: 'and?' },
        ],
      },
    ]);
  });

  it('keeps no thinking when thinking is off', async () => {
    const events = await collect(
      provider({ fetch: replies([...thinking, STOP]).fetch }).stream(request()),
    );

    expect(events).toEqual([{ type: 'done', stopReason: 'end_turn' }]);
  });
});
