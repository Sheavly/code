import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { answer } from '../../testing/summary-run.constants.js';
import { recording } from '../../testing/summary-run.fake.js';
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
        kind: 'agent',
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

/** Runs one turn; returns the messages the hook was given and the ones the provider was sent. */
async function run(edit: (messages: readonly Message[]) => Message[]) {
  const seen: Message[][] = [];
  const hook = defineHook({
    name: 'edit',
    beforeModelCall: ({ messages }) => {
      seen.push([...messages]);

      return Promise.resolve(edit(messages));
    },
  });
  const { provider, requests } = recording([answer]);

  await runAgent({ provider, tools: [], hooks: [hook], messages: history });

  return { seen: seen[0] ?? [], sent: requests[0]?.messages ?? [] };
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
