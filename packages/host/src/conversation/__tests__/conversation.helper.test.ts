import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';

const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];
const callTool = (id: string, name: string, input: Record<string, unknown> = {}): StreamEvent[] => [
  toolCall({ id, name, input }),
  { type: 'done', stopReason: 'tool_use' },
];

/** A tool that blocks until its run is aborted. */
const block = defineTool({
  name: 'block',
  description: 'Blocks until aborted',
  inputSchema: z.object({}),
  execute: ({ signal }) =>
    new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
});

/** A conversation on a scripted model, recording every session update as `type:state`. */
function setup(responses: StreamEvent[][], history: Message[] = [], hooks: Hook[] = []) {
  const seen: string[] = [];
  const requests: string[][] = [];
  const scripted = scriptedProvider(responses);
  const provider: Provider = {
    stream: (request) => {
      requests.push(request.messages.map((m) => `${m.role}:${m.role === 'tool' ? '' : m.content}`));

      return scripted.stream(request);
    },
  };
  const harness = createHarness({ provider, title: 'Chat' });

  harness.sessions.subscribe((u: SessionUpdate) => seen.push(`${u.type}:${u.session.state}`));

  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: [block, startTaskTool(harness.tasks)],
    hooks,
    messages: history,
  });

  return { harness, conversation, seen, requests };
}

/**
 * After a prompt stopped mid-tool-call: history holds the call and its placeholder result, and the
 * next prompt continues from it.
 */
async function expectContinuesAfterStop(
  params: Pick<ReturnType<typeof setup>, 'conversation' | 'requests'>,
) {
  const { conversation, requests } = params;

  expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  await collect(conversation.send('go on'));
  expect(requests[1]).toEqual(['user:wait', 'assistant:', 'tool:', 'user:go on']);
}

describe('a conversation', () => {
  it('runs two prompts in one session, the second on the first one’s history', async () => {
    const { harness, conversation, seen, requests } = setup([say('hello'), say('again')]);

    const first = await collect(conversation.send('hi'));
    const second = await collect(conversation.send('and now?'));

    expect(requests[1]).toEqual(['user:hi', 'assistant:hello', 'user:and now?']);
    expect(first.at(-1)).toMatchObject({ type: 'done', session: harness.mainSession });
    expect(second.at(-1)).toMatchObject({ type: 'done', session: harness.mainSession });
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(seen).toEqual(['session_idle:idle', 'session_resumed:running', 'session_idle:idle']);
    expect(harness.sessions.list()).toHaveLength(1);
  });

  it('continues from saved history in a new session, and keeps its history after closing', async () => {
    const saved: Message[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'noted', toolCalls: [] },
    ];
    const { conversation, requests } = setup([say('welcome back')], saved);

    await collect(conversation.send('remember?'));
    await conversation.close();

    expect(requests[0]).toEqual(['user:earlier', 'assistant:noted', 'user:remember?']);
    expect(conversation.messages).toHaveLength(4);
  });

  it('refuses a prompt while one runs, and once closed', async () => {
    const { conversation } = setup([say('slow'), say('later')]);
    const first = conversation.send('first');

    expect(conversation.running).toBe(true);
    expect(() => conversation.send('too soon')).toThrow(
      expect.objectContaining({ reason: 'session_running' }),
    );
    await collect(first);
    await conversation.close();
    expect(() => conversation.send('after')).toThrow(
      expect.objectContaining({ reason: 'session_ended' }),
    );
  });

  it('stops an aborted prompt with valid history, and the next prompt continues from it', async () => {
    const { conversation, requests } = setup([callTool('b1', 'block'), say('carried on')]);
    const stop = new AbortController();

    await collect(
      (async function* () {
        for await (const event of conversation.send('wait', { signal: stop.signal })) {
          if (event.type === 'tool_call_started') stop.abort();
          yield event;
        }
      })(),
    );
    await expectContinuesAfterStop({ conversation, requests });
  });

  it('stops a prompt the caller breaks off, keeps its history, and takes the next one', async () => {
    const { conversation, requests } = setup([callTool('b1', 'block'), say('next')]);

    for await (const event of conversation.send('wait')) {
      if (event.type === 'tool_call_started') break;
    }

    expect(conversation.running).toBe(false);
    await expectContinuesAfterStop({ conversation, requests });
  });

  it('runs sessionStart hooks once for the conversation, not on every prompt', async () => {
    const rules = defineHook({
      name: 'rules',
      sessionStart: async ({ addContext }) => addContext('house rules'),
    });
    const { conversation } = setup([say('one'), say('two')], [], [rules]);

    await collect(conversation.send('hi'));
    await collect(conversation.send('again'));

    expect(conversation.messages.filter((m) => m.content === 'house rules')).toHaveLength(1);
  });

  it('reports a background task from one prompt in the next', async () => {
    const { harness, conversation, requests } = setup([
      callTool('t1', 'start_task', { ms: 20, output: 'built' }),
      say('started it'),
      say('it finished'),
    ]);

    await collect(conversation.send('start the build'));
    await until(() => harness.tasks.hasUnreported);
    const next = await collect(conversation.send('how did it go?'));

    expect(next.some((event) => event.type === 'task_completed')).toBe(true);
    expect(requests[2]?.some((line) => line.includes('built'))).toBe(true);
  });

  it('makes every close() wait for the same cleanup', async () => {
    const { harness, conversation } = setup([
      callTool('t1', 'start_task', { ms: 60_000 }),
      say('started'),
    ]);

    await collect(conversation.send('start'));

    const first = conversation.close();
    const second = conversation.close();

    await second;
    expect(harness.tasks.runningCount).toBe(0);
    expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('completed');
    await first;
  });

  it('closing stops the running prompt and its tasks, and ends the session', async () => {
    const { harness, conversation, seen } = setup([
      callTool('t1', 'start_task', { ms: 60_000 }),
      say('started'),
      callTool('b1', 'block'),
    ]);

    await collect(conversation.send('start'));
    expect(harness.tasks.runningCount).toBe(1);
    const running = collect(conversation.send('block'));

    await until(() => seen.includes('session_resumed:running'));
    await conversation.close();
    await running;

    expect(harness.tasks.runningCount).toBe(0);
    expect(harness.sessions.get(harness.mainSession.id)?.state).not.toMatch(/running|idle/);
    expect(seen.at(-1)).toMatch(/^session_ended:/);
  });
});

describe("a long conversation's combined stream", () => {
  /** The replayable stream's size (JSON characters) after `prompts` prompts of 1,000 characters. */
  async function streamSize(prompts: number): Promise<number> {
    const text = 'x'.repeat(1000);
    const harness = createHarness({
      provider: scriptedProvider(Array.from({ length: prompts }, () => say(text))),
      title: 'Chat',
    });
    const conversation = createConversation({ harness, run: streamAgent, tools: [] });

    for (let index = 0; index < prompts; index++) await collect(conversation.send(text));

    let size = 0;
    const stop = harness.sessions.subscribeEntries(
      (entry) => (size += JSON.stringify(entry).length),
      { replay: true },
    );

    stop();
    await conversation.close();

    return size;
  }

  it('grows with the conversation, not with its square: no done keeps the history', async () => {
    const [ten, twenty] = [await streamSize(10), await streamSize(20)];

    // Twice the prompts, about twice the stream. With each done holding the history so far,
    // it would be about four times.
    expect(twenty / ten).toBeLessThan(2.5);
  });
});
