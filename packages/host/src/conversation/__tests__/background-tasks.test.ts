import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
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
  it('keeps a prompt active for finite work by default and delivers its completion', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask();
    const { events, running } = startBuild(conversation);

    try {
      await until(() => events.some((event) => event.type === 'turn_end'));
      expect(conversation.running).toBe(true);
      expect(events.some((event) => event.type === 'done')).toBe(false);
      expect(() => conversation.send('next')).toThrow('A prompt is still running');
      finish.resolve(undefined);
      await running;
      expect(seen).toHaveLength(1);
      expect(seen[0]?.messages.map((message) => message.content).join('\n')).toContain(
        'Build passed',
      );
      expect(events.filter((event) => event.type === 'task_completed')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
      expect(harness.tasks.runningCount).toBe(0);
    } finally {
      finish.resolve(undefined);
      await running;
      await conversation.close();
    }
  });

  it('wakes a finite-task wait for ordered follow-ups without cancelling the task', async () => {
    const { harness, conversation, finish, seen } = conversationWithTask();
    const { events, running } = startBuild(conversation);

    try {
      await until(() => harness.sessions.inboxWaiters(harness.mainSession.id) > 0);
      expect(conversation.followup('Focus on failures.')).toBe(true);
      expect(conversation.followup('Also include warnings.')).toBe(true);
      await until(() => seen.length === 1);
      expect(
        seen[0]?.messages.filter((message) => message.role === 'user').map((m) => m.content),
      ).toEqual(['build', 'Focus on failures.', 'Also include warnings.']);
      expect(harness.tasks.runningCount).toBe(1);
      expect(events.filter((event) => event.type === 'message_received')).toHaveLength(2);
      finish.resolve(undefined);
      await running;
      expect(seen).toHaveLength(2);
      expect(events.filter((event) => event.type === 'task_completed')).toHaveLength(1);
      expect(
        conversation.messages.filter((message) => message.role === 'user').map((m) => m.content),
      ).toEqual(['build', 'Focus on failures.', 'Also include warnings.']);
      expect(conversation.followup('too late')).toBe(false);
    } finally {
      finish.resolve(undefined);
      await running;
      await conversation.close();
    }
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
