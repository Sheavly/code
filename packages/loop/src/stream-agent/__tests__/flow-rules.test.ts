import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SESSION_DEPTH } from '@sheavly/runtime/sessions/sessions.constants';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { runSession } from '../stream-agent.helper.js';
import { assertValidHistory } from '../../history/history.utils.js';
import { viewOf } from '../../summary/summary.utils.js';
import {
  cancelOpenFlows,
  noticeKinds,
  recordingProvider,
  runUntilNotified,
  startFlow,
  startStoppable,
  userPrompt,
} from '../../testing/flow.fake.js';
import { say, WORK_KINDS } from '../../testing/work-kinds.fake.js';
import type { WorkKind } from '../../testing/work-kinds.types.js';

// Rules 5, 7 and 8 of "The flow that must hold" in `.agents/skills/sheavly/state-machines.md`.

afterEach(cancelOpenFlows);

const subAgent: WorkKind = WORK_KINDS.find((kind) => kind.name === 'sub-agent')!;

describe('flow rule 5 — finished work reaches the model once', () => {
  it.each(WORK_KINDS.filter((kind) => kind.background))(
    'rule 5: $name — a transient notice rides the call and is never stored in history',
    async (kind) => {
      const flow = startFlow(kind);
      const { provider, requests } = recordingProvider([
        kind.start({ speed: 'quick', id: 'c1' }),
        say('Started.'),
        say('Saw it.'),
      ]);
      const { messages } = await runSession({
        ...flow.options,
        provider: { ...provider, contextWindow: 10_000 },
        messages: userPrompt(),
      });
      const transient = requests.map((request) => request.notices?.[0]?.kind);

      expect(transient.every((noticeKind) => noticeKind === 'context-usage')).toBe(true);
      expect(JSON.stringify(messages)).not.toContain('context-usage');
    },
  );

  it.each(WORK_KINDS.filter((kind) => kind.background))(
    'rule 5: $name — the finished notice the model must remember is stored in history',
    async (kind) => {
      const { messages } = await runUntilNotified(kind, 'quick');

      expect(noticeKinds(messages)).toHaveLength(1);
    },
  );
});

describe('flow rule 7 — a sub-agent reports its status and the parent steers it', () => {
  async function startChild() {
    const flow = startFlow(subAgent);
    const { provider } = recordingProvider([
      subAgent.start({ speed: 'slow', id: 'c1' }),
      say('Started.'),
    ]);
    const yielding = new AbortController();

    yielding.abort();
    await runSession({
      ...flow.options,
      provider,
      messages: userPrompt(),
      yieldSignal: yielding.signal,
    });
    const [child] = flow.sessions.children(flow.ref.id);

    if (!child) throw new Error('the sub-agent session was not started');

    return { ...flow, child };
  }

  it('rule 7: the sub-agent reports its own status', async () => {
    const { sessions, child } = await startChild();

    sessions.report({ id: child.id, status: 'editing core' });

    expect(sessions.get(child.id)).toMatchObject({ status: 'editing core' });
  });

  it('rule 7: the parent steers it through its inbox', async () => {
    const { sessions, child, ref } = await startChild();

    sessions.send({ id: child.id, content: 'focus on tests', from: ref.id });

    expect(sessions.hasMessages(child.id)).toBe(true);
    expect(sessions.takeMessages(child.id)[0]).toMatchObject({ content: 'focus on tests' });
  });

  it('rule 7: a sub-agent whose loop throws ends its session as failed and tells the parent', async () => {
    const { tasks, sessions, ref, messages } = await runUntilNotified(subAgent, 'failing');
    const [child] = sessions.children(ref.id);

    const notices = messages.filter((m) => m.role === 'notice');

    expect(tasks.isReleased(taskIdSchema.parse('t1'))).toBe(true);
    expect(child).toMatchObject({ state: 'failed' });
    expect(notices).toHaveLength(1);
    // A failed run writes no report, so its notice is the task's, not an agent report.
    expect(notices[0]).toMatchObject({
      notice: { kind: 'task-finished', task: { status: 'failed' } },
    });
  });

  it('rule 7: depth is bounded', async () => {
    const sessions = new SessionRegistry();
    let parent = sessions.startMain({ title: 'Main' });

    for (let depth = 2; depth <= MAX_SESSION_DEPTH; depth++) {
      parent = sessions.startChild({
        parentId: parent.id,
        startedByCall: callIdSchema.parse(`d${depth}`),
        title: `Level ${depth}`,
      });
    }

    expect(() =>
      sessions.startChild({
        parentId: parent.id,
        startedByCall: callIdSchema.parse('too-deep'),
        title: 'Too deep',
      }),
    ).toThrow();
  });
});

describe.each(WORK_KINDS)('flow rule 8 — $name', (kind) => {
  it('rule 8: a stopped run leaves history valid, every tool call with a result', async () => {
    const { stopping, run } = startStoppable(kind);

    await new Promise((resolve) => setTimeout(resolve, 30));
    stopping.abort();
    const { messages } = await run;
    const results = messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId);

    expect(results).toContain('c1');
    expect(() => assertValidHistory({ messages: viewOf(messages), source: 'flow' })).not.toThrow();
  });
});
