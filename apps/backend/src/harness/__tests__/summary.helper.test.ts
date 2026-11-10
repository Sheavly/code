import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { callIdSchema, messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { backendSummary, subAgentSummary } from '../summary.helper.js';

const signal = new AbortController().signal;

/** A provider that answers every call with `reply` and keeps the requests. */
function answering(reply: string) {
  const requests: ProviderRequest[] = [];
  const events: StreamEvent[] = [
    { type: 'text_delta', text: reply },
    { type: 'done', stopReason: 'end_turn' },
  ];
  const provider: Provider = {
    async *stream(request) {
      requests.push(request);
      yield* events;
    },
  };

  return { provider, requests };
}

describe('backendSummary', () => {
  it('has the model write the sections, and rules keep the user’s words and the files touched', async () => {
    const { provider, requests } = answering('{"goal": "Fix the total.", "state": "Editing."}');
    const { summarizer } = backendSummary(provider);
    const result = await summarizer.summarize({
      messages: [
        {
          role: 'user',
          content: 'Fix the total.',
          id: messageIdSchema.parse('00000000-0000-4000-8000-000000000001'),
        },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: callIdSchema.parse('c1'),
              name: 'edit_file',
              input: { path: 'src/total.ts', oldText: 'a', newText: 'b' },
            },
          ],
        },
      ],
      signal,
    });
    const body = (id: string) => result.sections.find((section) => section.id === id)?.body;

    expect(requests).toHaveLength(1);
    expect(summarizer.name).toBe('backend');
    expect(body('goal')).toBe('Fix the total.');
    expect(body('user-messages')).toBe('- Fix the total.');
    expect(body('trail')).toBe('- edited src/total.ts');
  });

  it('titles a sub-agent’s task as the parent agent’s, not the user’s', async () => {
    const task = [
      {
        role: 'user' as const,
        content: 'Check the build.',
        id: messageIdSchema.parse('00000000-0000-4000-8000-000000000002'),
      },
    ];
    const titleOf = async (options: ReturnType<typeof backendSummary>) =>
      (await options.summarizer.summarize({ messages: task, signal })).sections.find(
        (section) => section.id === 'user-messages',
      )?.title;

    const reply = '{"goal": "Check."}';

    expect(await titleOf(subAgentSummary(answering(reply).provider))).toBe(
      'Task from the parent agent',
    );
    expect(await titleOf(backendSummary(answering(reply).provider))).toBe(
      'What the user asked for',
    );
  });

  it('uses the runtime’s redactor, so a credential the model restates is not stored', async () => {
    const { provider } = answering('{"goal": "Deploy, using password: hunter2 for the host."}');
    const result = await backendSummary(provider).summarizer.summarize({
      messages: [{ role: 'user', content: 'Deploy.' }],
      signal,
    });
    const goal = result.sections.find((section) => section.id === 'goal');

    expect(goal?.body).toBe('Deploy, using password: [REDACTED] for the host.');
  });

  it('asks whichever model the provider is on when it is called, so a switch changes who writes', async () => {
    let active = answering('{"goal": "first"}');
    const switching: Provider = { stream: (request) => active.provider.stream(request) };
    const { summarizer } = backendSummary(switching);
    const second = answering('{"goal": "second"}');

    await summarizer.summarize({ messages: [], signal });
    active = second;
    await summarizer.summarize({ messages: [], signal });

    expect(second.requests).toHaveLength(1);
  });
});
