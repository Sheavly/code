import { describe, expect, it } from 'vitest';
import { collect, fakeFetch, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { createMessagesProvider } from '../../anthropic-messages/messages.helper.js';
import { createResponsesProvider } from '../../responses/responses.helper.js';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

/** A time no other number in a request could be, so finding it means a message's `at` was sent. */
const AT = 1_793_799_215_947;
const id = callIdSchema.parse('c1');

const history: Message[] = [
  { role: 'user', content: 'look it up', at: AT },
  {
    role: 'assistant',
    content: 'on it',
    toolCalls: [{ id, name: 'lookup', input: { q: 'x' } }],
    at: AT + 1,
  },
  { role: 'tool', toolCallId: id, content: 'found', isError: false, at: AT + 2 },
];

/** Sends `history` through `provider` and checks that the body it posted carries no message time. */
async function expectTimeNotSent(params: {
  provider: Provider;
  sentBody: () => Record<string, unknown> | undefined;
}) {
  await collect(params.provider.stream(providerRequest({ messages: history })));

  const sent = JSON.stringify(params.sentBody());

  expect(sent).toContain('look it up');
  expect(sent).not.toContain(String(AT));
  expect(sent).not.toContain('"at"');
}

describe('a message’s time stays out of what the model is sent', () => {
  it('on the Responses protocol', async () => {
    const { fetch, requests } = fakeFetch([]);
    const provider = createResponsesProvider({
      endpoint: { baseUrl: 'https://example.test/v1', model: 'm', headers: {} },
      request: TEST_REQUEST,
      fetch,
    });

    await expectTimeNotSent({ provider, sentBody: () => requests[0]?.body });
  });

  it('on the Anthropic Messages protocol', async () => {
    const { fetch, requests } = fakeFetchSequence({
      responses: [[{ type: 'message_stop' }]],
      complete: false,
    });
    const provider = createMessagesProvider({
      endpoint: { baseUrl: 'https://example.test/anthropic/v1', model: 'claude', headers: {} },
      maxTokens: 4096,
      thinkingBudget: undefined,
      request: TEST_REQUEST,
      fetch,
    });

    await expectTimeNotSent({ provider, sentBody: () => requests[0]?.body });
  });
});
