import { describe, expect, it } from 'vitest';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { reply, testServer } from '@sheavly/server/testing/server.fake';
import { TEST_TOKEN } from '@sheavly/server/testing/testing.constants';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { RemoteConversation } from '../conversation.service.js';

/** A conversation over the server's real routes, served in-process: no port, no model. */
async function open(scripts: Record<string, Script[]> = {}) {
  const server = testServer(scripts);
  const conversation = await RemoteConversation.open({
    backend: {
      url: 'http://backend.test',
      token: TEST_TOKEN,
      stop: async () => undefined,
      fetch: async (input, init) => server.app.fetch(new Request(input, init)),
    },
  });

  return { conversation, server };
}

/** Every entry of a prompt, to its main session's `done`. */
async function sent(conversation: RemoteConversation, text: string, signal?: AbortSignal) {
  const entries: StreamEntry[] = [];

  for await (const entry of conversation.send({ text, ...(signal && { signal }) })) {
    entries.push(entry);
  }

  return entries;
}

const doneOf = (entries: StreamEntry[]) =>
  entries.findLast((entry) => entry.kind === 'event' && entry.event.type === 'done');

/** A turn that calls the blocking tool: the prompt runs until it is stopped. */
const block = () => [
  toolCall({ id: 'b1', name: 'block', input: {} }),
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

describe('RemoteConversation', () => {
  it('sends a prompt and reads its entries to the done, then the history', async () => {
    const { conversation } = await open({ hi: [reply('hello')] });
    const entries = await sent(conversation, 'hi');

    expect(doneOf(entries)).toMatchObject({ event: { reason: 'completed' } });
    expect((await conversation.messages()).map(({ content }) => content)).toEqual(['hi', 'hello']);
  });

  it('describes the run, and switches only to a model it has', async () => {
    const { conversation } = await open();

    expect(await conversation.details()).toMatchObject({
      workspace: '/work',
      model: { name: 'fast' },
    });
    expect(await conversation.useModel('deep')).toBe(true);
    expect((await conversation.details()).model.name).toBe('deep');
    expect(await conversation.useModel('huge')).toBe(false);
  });

  it('stops the prompt on the backend when its signal aborts, and still ends with its done', async () => {
    const { conversation } = await open({ wait: [block] });
    const stop = new AbortController();
    const entries: StreamEntry[] = [];

    for await (const entry of conversation.send({ text: 'wait', signal: stop.signal })) {
      entries.push(entry);
      // The blocking tool is running: abort, as Ctrl+C does.
      if (entry.kind === 'event' && entry.event.type === 'tool_call_started') stop.abort();
    }

    expect(doneOf(entries)).toMatchObject({ event: { reason: 'interrupted' } });
  });

  it('counts a background task from its start in the stream to its end', async () => {
    const { conversation, server } = await open({ wait: [block] });
    const { harness } = server.conversations.get(conversation.id);
    const stop = new AbortController();
    const counts: number[] = [];
    let finish: () => void = () => undefined;

    for await (const entry of conversation.send({ text: 'wait', signal: stop.signal })) {
      // The prompt is held on the blocking tool: a task starts now, as a tool's would, so its
      // start is in this prompt's stream; then the prompt is stopped.
      if (entry.kind === 'event' && entry.event.type === 'tool_call_started') {
        harness.tasks.start({
          command: 'npm run dev',
          description: 'Dev server',
          sessionId: harness.mainSession.id,
          run: () => new Promise((resolve) => (finish = () => resolve({ exitCode: 0 }))),
        });
      }

      if (entry.kind === 'task') {
        counts.push(conversation.runningTasks);
        stop.abort();
      }
    }

    finish();
    expect(counts).toEqual([1]);
  });

  it('closes the conversation: the backend no longer has it', async () => {
    const { conversation } = await open();

    await conversation.close();
    await expect(conversation.details()).rejects.toMatchObject({
      name: 'ServerRefusedError',
      code: 'not_found',
    });
  });
});
