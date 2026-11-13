import { describe, expect, it } from 'vitest';
import { runSession } from '../stream-agent.helper.js';
import { recordingProvider, startFlow } from '../../testing/flow.fake.js';
import { say, WORK_KINDS } from '../../testing/work-kinds.fake.js';

// Reproduction, flow rule 7: a message a person sends to a running session is the user's own
// words, so it enters history with an `id`, the mark the user-messages summary section keeps
// messages by. It is pushed without one today. The fixing change flips `it.fails` to `it`.

/** Sends a user message to a running session and returns it as it ended up in history. */
async function steeringInHistory() {
  const flow = startFlow(WORK_KINDS[0]!);
  const { provider } = recordingProvider([say('Done.')]);

  flow.sessions.send({ id: flow.ref.id, content: 'also cover the edge case', from: 'user' });
  const { messages } = await runSession({
    ...flow.options,
    provider,
    messages: [{ role: 'user', content: 'start' }],
  });

  return messages.find(
    (message) => message.role === 'user' && message.content === 'also cover the edge case',
  );
}

describe('a steering message from the user', () => {
  it('pinned today: reaches history as a user message without an id', async () => {
    const steering = await steeringInHistory();

    expect(steering).toBeDefined();
    expect(steering).not.toHaveProperty('id');
  });

  it.fails('rule 7: enters history with an id, so a summary keeps it', async () => {
    expect(await steeringInHistory()).toHaveProperty('id');
  });
});
