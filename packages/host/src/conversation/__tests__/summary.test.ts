import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { SummaryOptions } from '@sheavly/core/summary/summary.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';
import type { RunPrompt } from '../conversation.types.js';

const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

const summary: SummaryOptions = {
  summarizer: { name: 'test', summarize: async () => ({ sections: [] }) },
  policy: { keepTokens: 100 },
};

/** A conversation whose runs are the real loop, recording the `summary` each one was given. */
function setup(options: { summary?: SummaryOptions }) {
  const given: (SummaryOptions | undefined)[] = [];
  const run: RunPrompt = (runOptions) => {
    given.push(runOptions.summary);

    return streamAgent(runOptions);
  };
  const harness = createHarness({
    provider: scriptedProvider([say('one'), say('two')]),
    title: 'Chat',
  });
  const conversation = createConversation({ harness, run, tools: [], ...options });

  return { conversation, given };
}

describe('a conversation with a summary option', () => {
  it('hands it to the run of every prompt, unchanged', async () => {
    const { conversation, given } = setup({ summary });

    await collect(conversation.send('first'));
    await collect(conversation.send('second'));

    expect(given).toHaveLength(2);
    expect(given[0]).toBe(summary);
    expect(given[1]).toBe(summary);
  });

  it('passes none when the app gave none, so the loop never writes a checkpoint', async () => {
    const { conversation, given } = setup({});

    await collect(conversation.send('first'));

    expect(given).toEqual([undefined]);
    expect(conversation.messages.some((message) => message.role === 'summary')).toBe(false);
  });
});
