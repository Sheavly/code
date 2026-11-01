import { describe, expect, it } from 'vitest';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { AgentEvent } from '../../../loop/events/events.types.js';
import { runSession, streamAgent } from '../../../loop/stream-agent/stream-agent.service.js';
import { SessionRegistry } from '../../../runtime/sessions/sessions.service.js';
import { TaskRegistry } from '../../../runtime/tasks/tasks.service.js';
import { calls, createStepPicker, say, toolCall } from '../../../testing/routed-provider.fake.js';
import type { Script } from '../../../testing/testing.types.js';
import { createMessageAgentTool } from '../message-agent.tool.js';
import { createSubAgentTool } from '../sub-agent.tool.js';

/** A promise you resolve later: holds a scripted step until the test lets it go. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, opened };
}

/**
 * Like `routedProvider`, but each script step may wait first (so a test can steer a sub-agent
 * while it's mid-task), and every request is recorded per session for assertions.
 */
function gatedProvider(scripts: Record<string, { wait?: Promise<void>; reply: Script }[]>) {
  const pick = createStepPicker(scripts);
  const seen = new Map<string, ProviderRequest[]>();
  const provider: Provider = {
    async *stream(request) {
      const { script, step } = pick(request);

      seen.set(script, [...(seen.get(script) ?? []), request]);
      await step?.wait;
      yield* (step?.reply ?? (() => []))(request);
    },
  };

  return { provider, seen };
}

const userTexts = (request: ProviderRequest | undefined) =>
  (request?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content);

describe('message_agent: steering a running sub-agent', () => {
  it('"research dogs", then "I specifically care about puppies": the sub-agent gets it, uncancelled', async () => {
    const sessions = new SessionRegistry();
    const tasks = new TaskRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const researching = gate();
    let childId = '';

    sessions.subscribe((u) => {
      if (u.type === 'session_started' && u.session.depth === 2) childId = u.session.id;
    });

    const { provider, seen } = gatedProvider({
      // Main: start the sub-agent; then (after the user's steer arrives) pass it on.
      'Research dogs for me': [
        {
          reply: calls(
            toolCall({
              id: 'm1',
              name: 'start_agent',
              input: { title: 'Dogs', task: 'Research dogs' },
            }),
          ),
        },
        {
          reply: () => [
            toolCall({
              id: 'm2',
              name: 'message_agent',
              input: { session: childId, message: 'Focus specifically on puppies.' },
            }),
            { type: 'done', stopReason: 'tool_use' } satisfies StreamEvent,
          ],
        },
        { reply: say('Waiting for the research.') },
        { reply: say('Here is the puppy research.') },
      ],
      // Sub-agent: report, then hold mid-task until the steer was sent, then answer.
      'Research dogs': [
        {
          reply: calls(
            toolCall({ id: 's1', name: 'report_status', input: { status: 'researching dogs' } }),
          ),
        },
        { wait: researching.opened, reply: say('Puppies: they sleep 18 hours a day.') },
      ],
    });

    const tools = [
      createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools: [] }),
      createMessageAgentTool({ sessions }),
    ];
    const events: AgentEvent[] = [];

    // The user steers the main session once the sub-agent is running.
    const run = (async () => {
      for await (const event of streamAgent({
        provider,
        tools,
        messages: [{ role: 'user', content: 'Research dogs for me' }],
        tasks,
        waitForTasks: true,
        session: { registry: sessions, ref: main },
      })) {
        events.push(event);

        if (event.type === 'task_running') {
          sessions.send({
            id: main.id,
            content: 'I specifically care about puppies',
            from: 'user',
          });
        }

        if (event.type === 'tool_result' && event.call.name === 'message_agent') researching.open();
      }
    })();

    await run;

    const child = sessions.get(childId);
    // The sub-agent's second model call had the parent's steer in its history.
    const childSecondCall = seen.get('Research dogs')?.[1];

    expect(child).toMatchObject({ parentId: main.id, state: 'completed' });
    expect(userTexts(childSecondCall).at(-1)).toMatch(
      new RegExp(
        `^Message from the agent that started you \\(session ${main.id}\\)[\\s\\S]*Focus specifically on puppies\\.$`,
      ),
    );
    // The main session saw the user's steer as a message, in its own ordered events.
    expect(events.find((e) => e.type === 'message_received')).toMatchObject({
      message: { from: 'user', content: 'I specifically care about puppies' },
    });
    // Nothing was cancelled: the task completed, and its reply reached the main session.
    expect(tasks.list()[0]?.status).toBe('completed');
    expect(tasks.list()[0]?.output).toContain('[message] Focus specifically on puppies.');
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('wakes a sub-agent waiting idle on its own tasks, so it acts on the message', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const child = sessions.startChild({ parentId: main.id, title: 'Idle' });
    const childTasks = new TaskRegistry();
    const taskDone = gate();
    const { provider, seen } = gatedProvider({
      Idle: [{ reply: say('Waiting on my task.') }, { reply: say('Got it: puppies.') }],
    });

    // A task that only ends when the test says so: without the message, the sub-agent would sit
    // waiting for it.
    childTasks.start({
      command: 'slow',
      description: 'slow',
      run: () => taskDone.opened.then(() => ({ exitCode: 0 })),
    });

    const done = runSession({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'Idle' }],
      tasks: childTasks,
      waitForTasks: true,
      maxTurns: 2,
      session: { registry: sessions, ref: child },
    });

    // Let it reach the idle wait, then steer it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.get('Idle')).toHaveLength(1);
    sessions.send({ id: child.id, content: 'puppies only', from: main.id });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The message woke it: a second model call, with the message, before the task finished.
    expect(seen.get('Idle')).toHaveLength(2);
    expect(userTexts(seen.get('Idle')?.[1]).at(-1)).toContain('puppies only');

    taskDone.open();
    const { messages } = await done;

    expect(messages.some((m) => m.content === 'Got it: puppies.')).toBe(true);
  });

  it('a message arriving during the last turn gets one more turn instead of ending the run', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const { provider, seen } = gatedProvider({
      Start: [
        {
          reply: () => {
            sessions.send({ id: main.id, content: 'one more thing', from: 'user' });

            return [
              { type: 'text_delta', text: 'first' },
              { type: 'done', stopReason: 'end_turn' },
            ];
          },
        },
        { reply: say('second') },
      ],
    });

    const { reason, messages } = await runSession({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'Start' }],
      session: { registry: sessions, ref: main },
    });

    expect(reason).toBe('completed');
    expect(seen.get('Start')).toHaveLength(2);
    expect(messages.map((m) => m.content)).toEqual(['Start', 'first', 'one more thing', 'second']);
  });

  it('refuses to message a session the caller did not start', async () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const a = sessions.startChild({ parentId: main.id, title: 'A' });
    const b = sessions.startChild({ parentId: main.id, title: 'B' });
    const tool = createMessageAgentTool({ sessions });
    const signal = new AbortController().signal;

    await expect(
      tool.execute({
        input: { session: b.id, message: 'hi' },
        signal,
        context: { callId: 'c', description: 'd', session: a },
      }),
    ).rejects.toThrow('did not start');
    await expect(
      tool.execute({
        input: { session: a.id, message: 'hi' },
        signal,
        context: { callId: 'c', description: 'd' },
      }),
    ).rejects.toThrow('only works inside an agent session');
    expect(sessions.hasMessages(b.id)).toBe(false);
  });
});
