import { describe, expect, it } from 'vitest';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { streamAgent } from '../stream-agent.helper.js';

const on: StreamEvent = { type: 'reasoning_activity', active: true };
const off: StreamEvent = { type: 'reasoning_activity', active: false };

async function collect(provider: Provider): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];

  try {
    for await (const event of streamAgent({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
    })) {
      events.push(event);
    }
  } catch (caughtError) {
    // Only the scripted provider failure is expected; its effect is checked via `run_failed`.
    if (!(caughtError instanceof Error) || caughtError.message !== 'stream dropped') {
      throw caughtError;
    }
  }

  return events;
}

const types = (events: AgentEvent[]) => events.map((event) => event.type);

describe('reasoning activity', () => {
  it('delivers transitions in order with the text, deduplicated across several blocks', async () => {
    const events = await collect(
      scriptedProvider([
        [
          on,
          on,
          off,
          off,
          { type: 'text_delta', text: 'hi' },
          on,
          off,
          { type: 'done', stopReason: 'end_turn' },
        ],
      ]),
    );

    expect(types(events)).toEqual([
      'reasoning_activity',
      'reasoning_activity',
      'text_delta',
      'reasoning_activity',
      'reasoning_activity',
      'usage',
      'turn_end',
      'done',
    ]);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  });

  it('closes activity that the model call left open', async () => {
    const events = await collect(
      scriptedProvider([[on, { type: 'done', stopReason: 'end_turn' }]]),
    );

    expect(types(events)).toEqual([
      'reasoning_activity',
      'reasoning_activity',
      'usage',
      'turn_end',
      'done',
    ]);
    expect(events[1]).toMatchObject({ type: 'reasoning_activity', active: false });
  });

  it('closes activity before reporting a failed stream', async () => {
    const provider: Provider = {
      async *stream() {
        yield on;
        throw new Error('stream dropped');
      },
    };
    const events = await collect(provider);

    expect(types(events).slice(0, 3)).toEqual([
      'reasoning_activity',
      'reasoning_activity',
      'usage',
    ]);
    expect(types(events)).toContain('run_failed');
    expect(events.filter((event) => event.type === 'reasoning_activity').at(-1)).toMatchObject({
      active: false,
    });
  });

  it('closes activity when the run is aborted while the model reasons', async () => {
    const controller = new AbortController();
    const provider: Provider = {
      async *stream() {
        yield on;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      },
    };
    const events: AgentEvent[] = [];

    for await (const event of streamAgent({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === 'reasoning_activity') controller.abort();
    }

    const activity = events.filter((event) => event.type === 'reasoning_activity');

    expect(activity).toMatchObject([{ active: true }, { active: false }]);
    expect(types(events).at(-1)).toBe('done');
  });

  it('never puts activity into the conversation history', async () => {
    const events = await collect(
      scriptedProvider([[on, off, { type: 'done', stopReason: 'end_turn' }]]),
    );
    const done = events.at(-1);

    if (done?.type !== 'done') throw new Error('Missing done event');
    expect(JSON.stringify(done.messages)).not.toContain('reasoning_activity');
    expect(done.messages[1]).not.toHaveProperty('reasoning');
  });

  it('sends no activity when the provider cannot observe reasoning', async () => {
    const events = await collect(
      scriptedProvider([
        [
          { type: 'text_delta', text: 'hi' },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ]),
    );

    expect(types(events)).not.toContain('reasoning_activity');
  });
});
