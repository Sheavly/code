import { describe, expect, it } from 'vitest';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { runSession } from '../stream-agent.helper.js';

const say = (text: string) => [
  { type: 'text_delta' as const, text },
  { type: 'done' as const, stopReason: 'end_turn' as const },
];
const failing: Provider = {
  /** Fails before streaming anything. */
  async *stream() {
    await Promise.resolve();
    yield* [];
    throw new Error('model down');
  },
};

describe('a kept session', () => {
  it('goes idle with how the run ended instead of ending, and the next run resumes it', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const provider = scriptedProvider([say('one'), say('two')]);
    const first = await runSession({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'hi' }],
      session: { registry, ref },
      keepSession: true,
    });

    expect(registry.get(ref.id)).toMatchObject({ state: 'idle', lastOutcome: 'completed' });

    registry.resume(ref.id);
    await runSession({
      provider,
      tools: [],
      messages: [...first.messages, { role: 'user', content: 'again' }],
      session: { registry, ref },
      keepSession: true,
    });

    expect(registry.get(ref.id)).toMatchObject({ state: 'idle', lastOutcome: 'completed' });
  });

  it('goes idle as failed when the run fails, so the conversation can go on', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });

    await expect(
      runSession({
        provider: failing,
        tools: [],
        messages: [{ role: 'user', content: 'hi' }],
        session: { registry, ref },
        keepSession: true,
      }),
    ).rejects.toThrow('model down');
    expect(registry.get(ref.id)).toMatchObject({ state: 'idle', lastOutcome: 'failed' });
  });

  it('runs sessionStart once per session: a resumed run skips it', async () => {
    const started: string[] = [];
    const rules = defineHook({
      name: 'rules',
      sessionStart: async ({ addContext }) => {
        started.push('sessionStart');
        addContext('house rules');
      },
    });
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'Chat' });
    const options = {
      provider: scriptedProvider([say('one'), say('two')]),
      tools: [],
      hooks: [rules],
      session: { registry, ref },
      keepSession: true,
    };
    const first = await runSession({ ...options, messages: [{ role: 'user', content: 'hi' }] });

    registry.resume(ref.id);
    const second = await runSession({
      ...options,
      messages: [...first.messages, { role: 'user', content: 'again' }],
      resumed: true,
    });

    expect(started).toEqual(['sessionStart']);
    expect(second.messages.filter((m) => m.content.includes('house rules'))).toHaveLength(1);
  });

  it('ends the session as before without keepSession', async () => {
    const registry = new SessionRegistry();
    const ref = registry.startMain({ title: 'One shot' });

    await runSession({
      provider: scriptedProvider([say('done')]),
      tools: [],
      messages: [{ role: 'user', content: 'hi' }],
      session: { registry, ref },
    });

    expect(registry.get(ref.id)).toMatchObject({ state: 'completed', lastOutcome: 'completed' });
  });
});
