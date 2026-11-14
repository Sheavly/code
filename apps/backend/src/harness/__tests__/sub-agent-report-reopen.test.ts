import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { testBackend } from '../../testing/backend.fake.js';
import { seedFakeModel } from '../../testing/seed-model.fake.js';

// Flow rule 5: a finished sub-agent's report is a persistent notice, so a conversation closed and
// reopened returns it, whole, from its stored history.

const TASK = 'REPORT_TASK';

/** The model: the parent starts one sub-agent, the sub-agent answers, the parent then ends. */
const model: typeof globalThis.fetch = async (input, init) => {
  const body = JSON.parse(await new Request(input, init).text()) as {
    input: { role?: string; content?: string | { text: string }[] }[];
  };
  const first = body.input.find((item) => item.role === 'user')?.content;
  const asked = typeof first === 'string' ? first : first?.map(({ text }) => text).join('');
  const used = JSON.stringify(body.input);
  const answer = (delta: string) => fakeFetch([{ type: 'response.output_text.delta', delta }]);

  if (asked === TASK) return answer('Whole report text').fetch(input, init);

  if (used.includes('Whole report text')) return answer('Parent is done').fetch(input, init);

  // After the start, before the report: the model has nothing to add, so it ends its turn.
  if (used.includes('Started sub-agent')) return answer('Waiting for it').fetch(input, init);

  return fakeFetch([
    {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'start-1',
        name: 'start_agent',
        arguments: JSON.stringify({ description: 'Start', title: 'Reporter', task: TASK }),
      },
    },
  ]).fetch(input, init);
};

describe('a sub-agent report across a restart', () => {
  it('is returned whole by the reopened conversation, with the sub-agent card', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'sub-agent-report-reopen-'));
    const workspace = path.join(base, 'project');

    await mkdir(workspace);
    const backend = testBackend({ home: path.join(base, 'home'), workspace, fetch: model });

    try {
      await seedFakeModel(backend);
      const { client } = backend;
      const { id } = await client.call('startConversation', { body: {} });

      for await (const _entry of client.stream('sendPrompt', { id, body: { text: 'go' } })) {
        // Drained to the end: the report is delivered, and the notice stored, before it finishes.
      }

      const reportsOf = async () =>
        (await client.call('getMessages', { id })).messages.flatMap((message) =>
          message.role === 'notice' && message.notice.kind === 'agent-report'
            ? [{ title: message.notice.agent.title, report: message.notice.report }]
            : [],
        );
      const before = await reportsOf();

      await client.send('closeConversation', { id });
      await client.call('reopenConversation', { id });

      expect(before).toEqual([{ title: 'Reporter', report: 'Whole report text' }]);
      expect(await reportsOf()).toEqual(before);
    } finally {
      await backend.conversations.closeAll();
      await rm(base, { recursive: true, force: true });
    }
  });
});
