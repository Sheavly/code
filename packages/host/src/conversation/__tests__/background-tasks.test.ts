import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';

/** The task cannot finish until the test releases it, independently of model turns. */
function conversationWithTask(backgroundKind?: 'task' | 'service') {
  const finish = Promise.withResolvers<undefined>();
  const seen: ProviderRequest[] = [];
  const answer = (request: ProviderRequest) => {
    seen.push(request);

    return say('The build passed.')(request);
  };
  const harness = createHarness({
    title: 'Build',
    provider: routedProvider({ build: [say('Waiting for the build.'), answer, answer] }),
  });

  harness.tasks.start({
    command: 'build',
    description: 'Build the project',
    sessionId: harness.mainSession.id,
    ...(backgroundKind && { backgroundKind }),
    run: async ({ onOutput }) => {
      await finish.promise;
      onOutput('Build passed');

      return { exitCode: 0 };
    },
  });

  const conversation = createConversation({ harness, run: streamAgent, tools: [] });

  return { harness, conversation, finish, seen };
}

/** Drive one prompt concurrently so the test can steer or release its finite work. */
function startBuild(conversation: ReturnType<typeof createConversation>) {
  const events: AgentEvent[] = [];
  const running = (async () => {
    for await (const event of conversation.send('build')) events.push(event);
  })();

  return { events, running };
}

/** Unlike the manually released build, this work must be stopped by lifecycle cleanup. */
function conversationWithCancellableWork(params: {
  backgroundKind: 'task' | 'service';
  stop?: AbortController;
}) {
  const { backgroundKind, stop } = params;
  const harness = createHarness({
    title: 'Build',
    provider: routedProvider({ build: [say('Waiting for the build.')] }),
  });

  harness.tasks.start({
    command: 'build',
    description: 'Build the project',
    sessionId: harness.mainSession.id,
    backgroundKind,
    run: async ({ signal }) => {
      await setTimeout(60_000, undefined, { signal });

      return { exitCode: 0 };
    },
  });

  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: [],
    // A service-only run can finish before its turn_end reaches the consumer.
    hooks: [defineHook({ name: 'interrupt-active-prompt', afterTurn: async () => stop?.abort() })],
  });

  return { harness, conversation };
}

describe('background task lifecycle in a conversation', () => {
  it.each(['task', 'service'] as const)('cancels a %s when its prompt is aborted', async (kind) => {
    const stop = new AbortController();
    const { harness, conversation } = conversationWithCancellableWork({
      backgroundKind: kind,
      stop,
    });
    const events: AgentEvent[] = [];

    try {
      for await (const event of conversation.send('build', { signal: stop.signal })) {
        events.push(event);
      }

      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
      expect(harness.tasks.list()).toMatchObject([{ status: 'cancelled' }]);
      expect(harness.tasks.runningCount).toBe(0);
      expect(conversation.running).toBe(false);
      expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('idle');
    } finally {
      await conversation.close();
    }
  });

  it('cancels an outliving service when the conversation closes', async () => {
    const { harness, conversation } = conversationWithCancellableWork({
      backgroundKind: 'service',
    });

    try {
      for await (const _event of conversation.send('build'));

      expect(harness.tasks.runningCount).toBe(1);
      await conversation.close();
      expect(harness.tasks.list()).toMatchObject([{ status: 'cancelled' }]);
      expect(harness.tasks.runningCount).toBe(0);
      expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('completed');
    } finally {
      await conversation.close();
    }
  });
  it('ends a prompt when the model finishes, leaving finite work running (rule 1)', async () => {
    const { harness, conversation, finish } = conversationWithTask();
    const { events, running } = startBuild(conversation);

    try {
      await running;
      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(conversation.running).toBe(false);
      expect(harness.tasks.runningCount).toBe(1);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('wakes the idle conversation when finite work finishes, delivering the notice once', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask();
    const { running } = startBuild(conversation);

    try {
      await running;
      expect(seen).toHaveLength(0);
      finish.resolve(undefined);
      await until(() => seen.length === 1);
      await until(() => !conversation.running);

      expect(seen[0]?.messages.map((message) => message.content).join('\n')).toContain(
        'Build passed',
      );
      expect(JSON.stringify(conversation.messages).split('Build passed')).toHaveLength(2);
      expect(harness.tasks.hasUnreported).toBe(false);
      expect(harness.sessions.get(harness.mainSession.id)?.state).toBe('idle');
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('refuses a prompt while the wake runs, and settleWake lets the next one start', async () => {
    const { conversation, finish, seen } = conversationWithTask();
    const { running } = startBuild(conversation);

    try {
      await running;
      finish.resolve(undefined);
      await until(() => conversation.running || seen.length > 0);
      await conversation.settleWake();
      expect(conversation.running).toBe(false);
      for await (const _event of conversation.send('what happened?'));
      expect(JSON.stringify(conversation.messages).split('Build passed')).toHaveLength(2);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('wakes later when a yielded run is followed by no prompt', async () => {
    const { conversation, finish, seen } = conversationWithTask();
    const { running } = startBuild(conversation);

    try {
      expect(conversation.yieldPrompt()).toBe(true);
      await running;
      finish.resolve(undefined);
      await until(() => seen.length === 1, 5_000);

      expect(JSON.stringify(seen[0]?.messages)).toContain('Build passed');
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('runs the main session with only await_tasks holding it open', async () => {
    const held: unknown[] = [];
    const harness = createHarness({
      title: 'Build',
      provider: routedProvider({ build: [say('ok')] }),
    });
    const conversation = createConversation({
      harness,
      tools: [],
      run: (runOptions) => {
        held.push(runOptions.holdOpenFor);

        return streamAgent(runOptions);
      },
    });

    try {
      for await (const _event of conversation.send('build'));

      expect(held).toEqual(['awaited']);
    } finally {
      await conversation.close();
    }
  });

  it('stops waking at the cap until the next prompt, which then gets the notice', async () => {
    const seen: ProviderRequest[] = [];
    const answer = (request: ProviderRequest) => {
      seen.push(request);

      return say('ok')(request);
    };
    const harness = createHarness({
      title: 'Build',
      provider: routedProvider({ build: [say('first'), answer, answer, answer] }),
    });
    const conversation = createConversation({
      harness,
      run: streamAgent,
      tools: [],
      maxConsecutiveWakes: 1,
    });
    const finishTask = async (label: string) => {
      harness.tasks.start({
        command: label,
        description: label,
        sessionId: harness.mainSession.id,
        run: async ({ onOutput }) => {
          onOutput(`${label} done`);

          return { exitCode: 0 };
        },
      });
      await until(() => harness.tasks.runningCount === 0);
    };

    try {
      for await (const _event of conversation.send('build'));

      await finishTask('task one');
      await until(() => seen.length === 1 && !conversation.running);

      await finishTask('task two');
      await setTimeout(100);
      expect(seen).toHaveLength(1);
      expect(harness.tasks.hasUnreported).toBe(true);

      for await (const _event of conversation.send('next'));

      expect(JSON.stringify(seen.at(-1)?.messages)).toContain('task two done');
    } finally {
      await conversation.close();
    }
  });

  it('starts no wake after a stop even while idle, until the next prompt', async () => {
    const { conversation, finish, seen } = conversationWithTask();
    const { running } = startBuild(conversation);

    try {
      await running;
      conversation.stop();
      finish.resolve(undefined);
      await setTimeout(100);
      expect(seen).toHaveLength(0);

      for await (const _event of conversation.send('what happened?'));

      expect(JSON.stringify(seen.at(-1)?.messages)).toContain('Build passed');
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });

  it('tells the app when the run it started itself fails, and goes idle', async () => {
    const failures: unknown[] = [];
    let calls = 0;
    const provider: Provider = {
      async *stream() {
        calls++;

        if (calls > 1) throw new Error('model down');

        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const harness = createHarness({ title: 'Build', provider });
    const conversation = createConversation({
      harness,
      run: streamAgent,
      tools: [],
      onWakeFailure: (error) => failures.push(error),
    });

    try {
      for await (const _event of conversation.send('build'));

      harness.tasks.start({
        command: 'build',
        description: 'Build',
        sessionId: harness.mainSession.id,
        run: async () => ({ exitCode: 0 }),
      });
      await until(() => failures.length === 1);
      await until(() => !conversation.running);

      expect(failures[0]).toMatchObject({ message: 'model down' });
    } finally {
      await conversation.close();
    }
  });

  it('does not wake after a close', async () => {
    const { conversation, finish, seen } = conversationWithTask();
    const { running } = startBuild(conversation);

    await running;
    // The build ignores cancellation, so it settles while the close is in flight.
    const closing = conversation.close();

    finish.resolve(undefined);
    await closing;
    await setTimeout(50);

    expect(seen).toHaveLength(0);
  });

  it('lets a service outlive a prompt without keeping it active', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask('service');
    const events: AgentEvent[] = [];

    try {
      for await (const event of conversation.send('build')) events.push(event);

      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(conversation.running).toBe(false);
      expect(harness.tasks.runningCount).toBe(1);
      expect(seen).toHaveLength(0);
      finish.resolve(undefined);
      await until(() => harness.tasks.runningCount === 0);
      expect(harness.tasks.hasUnreported).toBe(true);

      for await (const _event of conversation.send('what happened?'));

      expect(seen).toHaveLength(1);
      expect(seen[0]?.messages.map((message) => message.content).join('\n')).toContain(
        'Build passed',
      );
      expect(harness.tasks.hasUnreported).toBe(false);
    } finally {
      finish.resolve(undefined);
      await conversation.close();
    }
  });
});
