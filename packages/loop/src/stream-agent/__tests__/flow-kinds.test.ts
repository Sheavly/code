import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { until } from '@sheavly/testing/wait/until.fake';
import { runSession } from '../stream-agent.helper.js';
import {
  cancelOpenFlows,
  noticeKinds,
  recordingProvider,
  runRound,
  runUntilNotified,
  startFlow,
  startStoppable,
  userPrompt,
} from '../../testing/flow.fake.js';
import { say, WORK_KINDS } from '../../testing/work-kinds.fake.js';
import type { WorkKind } from '../../testing/work-kinds.types.js';

// One lifecycle suite for every kind of background work: a kind added to the harness is one entry
// in `WORK_KINDS`. See "The flow that must hold" in `.agents/skills/sheavly/state-machines.md`.

afterEach(cancelOpenFlows);

const t1 = taskIdSchema.parse('t1');
const kinds = WORK_KINDS.filter((kind) => kind.background);
/** A run that stays open on nothing: the work keeps running after the model finishes. */
const yielded = () => {
  const yielding = new AbortController();

  yielding.abort();

  return yielding.signal;
};

async function startRunning(kind: WorkKind) {
  const flow = startFlow(kind);
  const { provider } = recordingProvider([
    kind.start({ speed: 'slow', id: 'c1' }),
    say('Started.'),
  ]);
  const result = await runSession({
    ...flow.options,
    provider,
    messages: userPrompt(),
    yieldSignal: yielded(),
  });

  return { ...flow, result };
}

/** How the one notice in a history says the work ended, whichever kind of notice it is. */
function noticeOutcome(messages: readonly HistoryMessage[]): string | undefined {
  const entry = messages.find((message) => message.role === 'notice');

  if (entry?.role !== 'notice') return undefined;

  if (entry.notice.kind === 'agent-report') return entry.notice.outcome;

  return entry.notice.kind === 'task-finished' ? entry.notice.task.status : undefined;
}

describe.each(kinds)('background work lifecycle — $name', (kind) => {
  it('is listed while it runs', async () => {
    const { tasks, ref } = await startRunning(kind);

    expect(tasks.runningTasks(ref.id)).toHaveLength(1);
    expect(tasks.get(t1)?.status).toBe('running');
  });

  it('completes and its notice reaches the model', async () => {
    const { messages } = await runUntilNotified(kind, 'quick');

    expect(noticeOutcome(messages)).toBe('completed');
    expect(noticeKinds(messages)).toHaveLength(1);
  });

  it('fails and its notice says so', async () => {
    const { messages } = await runUntilNotified(kind, 'failing');

    expect(noticeOutcome(messages)).toBe('failed');
    expect(noticeKinds(messages)).toHaveLength(1);
  });

  it('is cancelled on request, silently', async () => {
    const { tasks, ref } = await startRunning(kind);
    const cancelled = await tasks.cancel(t1);

    expect(cancelled?.status).toBe('cancelled');
    expect(tasks.hasDeliveries(ref.id)).toBe(false);
  });

  it('is gone once its notice is delivered, so a later cancel finds nothing', async () => {
    const { tasks } = await runUntilNotified(kind, 'quick');

    expect(await tasks.cancel(t1)).toBeUndefined();
  });

  it('outlives the run that started it: the run ends when the model finishes (rule 1)', async () => {
    const flow = startStoppable(kind);
    const { stopping, run } = flow;

    await until(() => flow.tasks.runningCount === 1);

    // Nothing holds the main session open, so the run is over before the stop arrives.
    expect((await run).reason).toBe('completed');
    stopping.abort();
    expect(flow.tasks.get(t1)?.status).toBe('running');
  });

  it('notifies exactly once: the notice is in history once and nothing is left to deliver', async () => {
    const { tasks, ref, messages, requests } = await runUntilNotified(kind, 'quick');
    const finishedNotice = /<harness-notice kind="(task-finished|agent-report)">/g;
    const sentTo = (index: number) =>
      (requests[index]?.messages ?? [])
        .map((message) => ('content' in message ? message.content : ''))
        .join('\n')
        .match(finishedNotice)?.length ?? 0;

    expect(noticeKinds(messages)).toHaveLength(1);
    expect(sentTo(requests.length - 1)).toBe(1);
    expect(Math.max(...requests.map((_, index) => sentTo(index)))).toBe(1);
    expect(tasks.hasDeliveries(ref.id)).toBe(false);
  });

  it('stores its notice in history with the same shape as every other kind', async () => {
    const { messages } = await runUntilNotified(kind, 'quick');
    const notice = messages.find((m) => m.role === 'notice');

    if (notice?.role !== 'notice') throw new Error('no notice in history');

    expect(typeof notice.at).toBe('number');
    expect(['task-finished', 'agent-report']).toContain(notice.notice.kind);
    expect(notice.notice).toHaveProperty('context');
  });

  it('is released once delivered: the registry keeps no finished work, and knows it was released', async () => {
    const { tasks } = await runUntilNotified(kind, 'quick');

    expect(tasks.list()).toHaveLength(0);
    expect(tasks.get(t1)).toBeUndefined();
    expect(tasks.isReleased(t1)).toBe(true);
  });

  it('does not grow over many runs: each delivered task is released', async () => {
    const flow = startFlow(kind);
    let messages = userPrompt();
    let largest = 0;

    for (let round = 1; round <= 12; round++) {
      if (round > 1) flow.sessions.resume(flow.ref.id);
      const result = await runRound({
        flow,
        kind,
        speed: 'quick',
        id: `c${String(round)}`,
        messages,
        resumed: round > 1,
      });

      messages = result.messages;
      largest = Math.max(largest, flow.tasks.list().length);
    }

    expect(largest).toBeLessThanOrEqual(1);
    expect(flow.tasks.list()).toHaveLength(0);
    // Only the main session is left: each delivered sub-agent's session was released.
    expect(flow.sessions.list().map((session) => session.id)).toEqual([flow.ref.id]);
    expect(noticeKinds(messages)).toHaveLength(12);
  });
});
