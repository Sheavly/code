import { describe, expect, it } from 'vitest';
import { collect, fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { createResponsesProvider } from '../responses.helper.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';

const notice: HarnessNotice = { kind: 'context-usage', context: { window: 5 } };
const marker = { mode: 'explicit' };

const toolTurn = (id: string): Message[] => {
  const callId = callIdSchema.parse(id);

  return [
    { role: 'assistant', content: '', toolCalls: [{ id: callId, name: 'f', input: {} }] },
    { role: 'tool', toolCallId: callId, content: `result ${id}`, isError: false },
  ];
};

const sendAll = async (params: { explicitCache?: boolean; histories: Message[][] }) => {
  const { fetch, requests } = fakeFetch([{ type: 'response.output_text.delta', delta: 'ok' }]);
  const endpoint = { baseUrl: 'https://cache.test/v1', model: 'sol', headers: {} };
  const provider = createResponsesProvider({
    ...{ endpoint, fetch },
    explicitCache: params.explicitCache,
    request: TEST_REQUEST,
  });

  for (const messages of params.histories) {
    await collect(provider.stream(providerRequest({ messages, notices: [notice] })));
  }

  return requests.map((request) => request.body);
};

const markedTexts = (input: unknown): string[] =>
  JSON.stringify(input).match(/"text":"[^"]*","prompt_cache_breakpoint"/g) ?? [];

describe('Responses explicit caching', () => {
  const first: Message[] = [{ role: 'user', content: 'hi' }];
  const second = [...first, ...toolTurn('c1')];
  const third = [...second, ...toolTurn('c2')];

  it('marks retained history, never the trailing notice, and writes explicit-only', async () => {
    const [body] = await sendAll({ explicitCache: true, histories: [second] });
    const input = body?.input as { content: unknown }[];

    expect(body?.prompt_cache_options).toEqual(marker);
    expect(input.at(-1)).toEqual({ role: 'user', content: formatHarnessNotice(notice) });
    expect(input[0]).toEqual({
      role: 'user',
      content: [{ type: 'input_text', text: 'hi', prompt_cache_breakpoint: marker }],
    });
    expect(input[2]).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: [{ type: 'input_text', text: 'result c1', prompt_cache_breakpoint: marker }],
    });
  });

  it('keeps the previous request boundary marked on the next tool turn', async () => {
    const bodies = await sendAll({ explicitCache: true, histories: [second, third] });
    const [previous, next] = bodies.map((body) => body.input as unknown[]);

    // Everything the previous request sent before its notice is an exact prefix of the next.
    expect(next?.slice(0, (previous?.length ?? 0) - 1)).toEqual(previous?.slice(0, -1));
    expect(markedTexts(next)).toContain('"text":"result c1","prompt_cache_breakpoint"');
    expect(markedTexts(next)).toContain('"text":"result c2","prompt_cache_breakpoint"');
  });

  it.each([4, 6])('keeps a previous lookup boundary across batches of %s tools', async (count) => {
    const batch = (prefix: string): Message[] => {
      const calls = Array.from({ length: count }, (_, index) => ({
        id: callIdSchema.parse(`${prefix}${index}`),
        name: 'f',
        input: {},
      }));

      return [
        { role: 'assistant', content: '', toolCalls: calls },
        ...calls.map((call): Message => ({
          role: 'tool',
          toolCallId: call.id,
          content: `result ${call.id}`,
          isError: false,
        })),
      ];
    };
    const afterFirst = [...first, ...batch('a')];
    const bodies = await sendAll({
      explicitCache: true,
      histories: [first, afterFirst, [...afterFirst, ...batch('b')]],
    });

    expect(markedTexts(bodies[1]?.input)).toContain('"text":"hi","prompt_cache_breakpoint"');
    expect(markedTexts(bodies[2]?.input)).toContain(
      `"text":"result a${count - 1}","prompt_cache_breakpoint"`,
    );
    expect(markedTexts(bodies[1]?.input)).toHaveLength(4);
    expect(markedTexts(bodies[2]?.input)).toHaveLength(4);
  });

  it('marks at most four breakpoints, the latest ones', async () => {
    const long = [...first, ...toolTurn('a'), ...toolTurn('b'), ...toolTurn('c'), ...toolTurn('d')];
    const [body] = await sendAll({ explicitCache: true, histories: [long] });

    expect(markedTexts(body?.input)).toHaveLength(4);
    expect(markedTexts(body?.input)).not.toContain('"text":"hi","prompt_cache_breakpoint"');
  });

  it('sends no caching fields and plain strings when it is off', async () => {
    const [body] = await sendAll({ histories: [second] });

    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(JSON.stringify(body?.input)).not.toContain('prompt_cache_breakpoint');
    expect((body?.input as { content: unknown }[])[0]?.content).toBe('hi');
  });
});
