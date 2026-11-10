import { expect, it } from 'vitest';
import { fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { createResponsesProvider } from '@sheavly/providers/responses/responses.helper';
import { TEST_REQUEST } from '@sheavly/providers/testing/request.constants';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { createHarness } from '../host.helper.js';

it.each(['response.completed', 'response.incomplete'])(
  'keeps persisted entries replayable when %s contains inconsistent usage',
  async (type) => {
    const invalidUsage = {
      input_tokens: 10,
      output_tokens: 0,
      input_tokens_details: { cached_tokens: 10, cache_write_tokens: 1 },
    };
    const { fetch } = fakeFetch([
      {
        type,
        response: { usage: invalidUsage, incomplete_details: { reason: 'max_output_tokens' } },
      },
    ]);
    const persisted: StreamEntry[] = [];
    const provider = createResponsesProvider({
      endpoint: { baseUrl: 'https://usage.test/v1', model: 'm', headers: {} },
      request: TEST_REQUEST,
      fetch,
    });
    const { sessions, mainSession } = createHarness({
      provider,
      title: 'Invalid usage',
      entries: {
        async append(entry) {
          persisted.push(structuredClone(entry));
        },
        async *read() {
          yield* persisted;
        },
      },
    });

    await expect(
      runSession({
        provider,
        tools: [],
        messages: [{ role: 'user', content: 'Hello' }],
        session: { registry: sessions, ref: mainSession },
      }),
    ).rejects.toThrow('Responses stream ended before response.completed');
    await sessions.flushStore();

    expect(persisted.length).toBeGreaterThan(0);
    const recordedUsage = persisted.flatMap((entry) =>
      entry.kind === 'event' && entry.event.type === 'usage' ? [entry.event.usage.tokens] : [],
    );

    expect(recordedUsage).toEqual([null]);

    for (const entry of persisted) {
      expect(streamEntrySchema.parse(entry)).toEqual(entry);
    }
  },
);
