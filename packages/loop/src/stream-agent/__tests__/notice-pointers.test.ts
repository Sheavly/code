import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { runAgent } from '../stream-agent.helper.js';

const CONTEXT = {
  reason: 'Compare',
  startedAt: 10,
  durationMs: 10,
  userMessagesSinceStart: 1,
  callId: 'launch',
};
const NOTICE_AT = 20;
const history: HistoryMessage[] = [
  { role: 'user', content: 'Review changes', at: 1 },
  historyMessageSchema.parse({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'launch', name: 'start_task', input: {} }],
    at: 10,
  }),
  historyMessageSchema.parse({
    role: 'tool',
    toolCallId: 'launch',
    content: 'Started',
    isError: false,
    at: 11,
  }),
  historyMessageSchema.parse({
    role: 'notice',
    at: NOTICE_AT,
    notice: {
      kind: 'task-finished',
      task: {
        id: 't1',
        command: 'review',
        description: 'Review',
        status: 'completed',
        startedAt: 10,
        endedAt: 20,
        output: 'Findings',
      },
      context: CONTEXT,
    },
  }),
  { role: 'user', content: 'Continue', at: 30 },
];

const POINTER = 'starting tool call ID launch';

/** Wraps a provider and keeps a copy of the messages each model call was sent. */
function recording(inner: Provider, sent: Message[][]): Provider {
  return {
    contextWindow: 1_000,
    stream: (request) => {
      sent.push([...request.messages]);

      return inner.stream(request);
    },
  };
}

/** Runs one turn; returns the messages the hook was given and the ones the provider was sent. */
async function run(edit: (messages: readonly Message[]) => Message[]) {
  const seen: Message[][] = [];
  const sent: Message[][] = [];
  const hook = defineHook({
    name: 'edit',
    beforeModelCall: ({ messages }) => {
      seen.push([...messages]);

      return Promise.resolve(edit(messages));
    },
  });
  const provider = scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]);

  await runAgent({
    provider: recording(provider, sent),
    tools: [],
    hooks: [hook],
    messages: history,
  });

  return { seen: seen[0] ?? [], sent: sent[0] ?? [] };
}

const noticeIn = (messages: readonly Message[]) =>
  messages.find((message) => message.at === NOTICE_AT)?.content;

describe('a completion notice in the model input', () => {
  it('shows a beforeModelCall hook the same text the model is sent', async () => {
    const { seen, sent } = await run((messages) => [...messages]);

    expect(noticeIn(seen)).toContain(POINTER);
    expect(noticeIn(sent)).toBe(noticeIn(seen));
  });

  it('keeps what a hook wrote, with no pass over the text after it', async () => {
    const { sent } = await run((messages) =>
      messages.map((message) =>
        message.at === NOTICE_AT
          ? { ...message, content: `Hook note\n${message.content}` }
          : message,
      ),
    );

    expect(noticeIn(sent)).toMatch(/^Hook note\n/);
  });

  it('keeps the pointer when a hook drops the call it names: the id stays as data', async () => {
    const { sent } = await run((messages) => messages.filter((message) => message.role === 'user'));

    expect(noticeIn(sent)).toContain(POINTER);
  });
});
