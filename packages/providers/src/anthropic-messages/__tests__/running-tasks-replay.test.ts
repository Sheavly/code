import { describe, expect, it } from 'vitest';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { providerRequest } from '../../testing/provider-request.fake.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';
import { RUNNING_TASKS_NOTICE } from '../../testing/running-tasks.fake.js';
import { createMessagesProvider } from '../messages.helper.js';
import { toMessagesApiMessages, withNotices } from '../input.utils.js';
import { messagesPrefix } from '../prefix.utils.js';
import type { MessagesApiMessage, MessagesReplay } from '../messages.types.js';

const instructions = 'Fixed system instructions';
const endpoint = { baseUrl: 'https://example.test/v1', model: 'claude', headers: {} };
const source = `messages:${endpoint.baseUrl}#${endpoint.model}`;
const replyBlocks = (id: string): MessagesReplay['content'] => [
  { type: 'thinking', thinking: 'Consider', signature: id },
  { type: 'redacted_thinking', data: `encrypted-${id}` },
  { type: 'text', text: id },
  { type: 'tool_use', id: callIdSchema.parse(id), name: 'lookup', input: {} },
];
const replyFrames = (id: string) => [
  ...replyBlocks(id).flatMap((block, index) => [
    { type: 'content_block_start', index, content_block: block },
    { type: 'content_block_stop', index },
  ]),
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' },
];
const retainedReply = (id: string, events: StreamEvent[]): Message => ({
  role: 'assistant',
  content: id,
  toolCalls: [{ id: callIdSchema.parse(id), name: 'lookup', input: {} }],
  reasoning: events.flatMap((event) => (event.type === 'reasoning' ? [event.item] : [])),
});
const result = (id: string): Message => ({
  role: 'tool',
  toolCallId: callIdSchema.parse(id),
  content: `result-${id}`,
  isError: false,
});
const changedNotice: HarnessNotice = {
  ...RUNNING_TASKS_NOTICE,
  tasks: RUNNING_TASKS_NOTICE.tasks.map((task) => ({
    ...task,
    reason: 'Wait for updated results.',
  })),
};
const translate = (messages: Message[]) =>
  toMessagesApiMessages({ messages, reasoningSource: source, instructions, tools: [] });

describe('running task notices and signed Messages replay', () => {
  it.each([
    { label: 'changed', notices: [changedNotice] },
    { label: 'removed', notices: [] },
    { label: 'identical', notices: [RUNNING_TASKS_NOTICE] },
  ])(
    'replays notice-bound thinking with its notice when the next call has $label notices',
    async ({ notices }) => {
      const { fetch, requests } = fakeFetchSequence({
        responses: [
          replyFrames('earlier'),
          replyFrames('noticed'),
          replyFrames('fresh'),
          [{ type: 'message_stop' }],
        ],
        complete: false,
      });
      const provider = createMessagesProvider({
        endpoint,
        maxTokens: 4096,
        thinkingMode: 'adaptive',
        request: TEST_REQUEST,
        fetch,
      });
      const history: Message[] = [{ role: 'user', content: 'Go' }];
      const earlier = await collect(
        provider.stream(providerRequest({ instructions, messages: history })),
      );

      history.push(retainedReply('earlier', earlier), result('earlier'));
      const noticed = await collect(
        provider.stream(
          providerRequest({
            instructions,
            messages: history,
            notices: [RUNNING_TASKS_NOTICE],
          }),
        ),
      );

      expect(noticed).toContainEqual({
        type: 'reasoning',
        item: {
          source,
          data: {
            type: 'messages-replay',
            prefix: messagesPrefix({
              instructions,
              tools: [],
              messages: withNotices({
                messages: translate(history),
                notices: [RUNNING_TASKS_NOTICE],
              }),
            }),
            content: replyBlocks('noticed'),
            notices: [{ type: 'text', text: formatHarnessNotice(RUNNING_TASKS_NOTICE) }],
          },
        },
      });
      history.push(retainedReply('noticed', noticed), result('noticed'));
      const original = structuredClone(history);
      const fresh = await collect(
        provider.stream(providerRequest({ instructions, messages: history, notices })),
      );
      const sent = requests[2]?.body.messages as MessagesApiMessage[];

      expect(sent[1]?.content).toEqual(replyBlocks('earlier'));
      // The notice the reply was signed over comes back in the same place, whatever this call sends.
      expect(sent[2]?.content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'earlier',
          content: 'result-earlier',
          is_error: false,
        },
        { type: 'text', text: formatHarnessNotice(RUNNING_TASKS_NOTICE) },
      ]);
      expect(sent[3]?.content).toEqual(replyBlocks('noticed'));
      expect(sent.at(-1)?.content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'noticed',
          content: 'result-noticed',
          is_error: false,
          ...(notices.length > 0 && { cache_control: { type: 'ephemeral' } }),
        },
        ...notices.map((notice) => ({ type: 'text', text: formatHarnessNotice(notice) })),
      ]);
      expect(history).toEqual(original);
      expect(requests.map((request) => request.body.system)).toEqual([
        instructions,
        instructions,
        instructions,
      ]);

      // A reply made with other notices replays too, and a call with none sends only history.
      history.push(retainedReply('fresh', fresh), result('fresh'));
      await collect(provider.stream(providerRequest({ instructions, messages: history })));
      const replayed = requests[3]?.body.messages as MessagesApiMessage[];

      expect(replayed[1]?.content).toEqual(replyBlocks('earlier'));
      expect(replayed[3]?.content).toEqual(replyBlocks('noticed'));
      expect(replayed[5]?.content).toEqual(replyBlocks('fresh'));
      expect(replayed.at(-1)?.content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'fresh',
          content: 'result-fresh',
          is_error: false,
        },
      ]);
    },
  );

  it('also drops later signatures whose recorded prefix depended on the removed thinking', () => {
    const initial: Message = { role: 'user', content: 'Go' };
    const prior: Message = {
      role: 'assistant',
      content: 'noticed',
      toolCalls: [{ id: callIdSchema.parse('noticed'), name: 'lookup', input: {} }],
      reasoning: [
        {
          source,
          data: {
            type: 'messages-replay',
            prefix: messagesPrefix({
              instructions,
              tools: [],
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Go' },
                    { type: 'text', text: formatHarnessNotice(RUNNING_TASKS_NOTICE) },
                  ],
                },
              ],
            }),
            content: replyBlocks('noticed'),
          },
        },
      ],
    };
    // A persisted later reply may have been signed over the original prior thinking blocks.
    const preceding: MessagesApiMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Go' }] },
      { role: 'assistant', content: replyBlocks('noticed') },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'noticed',
            content: 'result-noticed',
            is_error: false,
          },
          { type: 'text', text: 'Continue' },
        ],
      },
    ];
    const later: Message = {
      role: 'assistant',
      content: 'later',
      toolCalls: [{ id: callIdSchema.parse('later'), name: 'lookup', input: {} }],
      reasoning: [
        {
          source,
          data: {
            type: 'messages-replay',
            prefix: messagesPrefix({ instructions, tools: [], messages: preceding }),
            content: replyBlocks('later'),
          },
        },
      ],
    };
    const validPrior: Message = {
      ...prior,
      reasoning: [
        {
          source,
          data: {
            type: 'messages-replay',
            prefix: messagesPrefix({ instructions, tools: [], messages: preceding.slice(0, 1) }),
            content: replyBlocks('noticed'),
          },
        },
      ],
    };
    const continuation: Message = { role: 'user', content: 'Continue' };
    const matching = translate([initial, validPrior, result('noticed'), continuation, later]);

    expect(matching[1]?.content).toEqual(replyBlocks('noticed'));
    expect(matching[3]?.content).toEqual(replyBlocks('later'));
    const history = [initial, prior, result('noticed'), continuation, later];
    const original = structuredClone(history);
    const sent = translate(history);

    expect(sent[1]?.content).toEqual(replyBlocks('noticed').slice(2));
    expect(sent[3]?.content).toEqual(replyBlocks('later').slice(2));
    expect(history).toEqual(original);
  });
});
