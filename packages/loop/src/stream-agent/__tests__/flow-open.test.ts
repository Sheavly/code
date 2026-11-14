import { afterEach, describe, expect, it } from 'vitest';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { runSession } from '../stream-agent.helper.js';
import { HELD_MS, SETTLES_MS } from '../../testing/flow.constants.js';
import {
  cancelOpenFlows,
  recordingProvider,
  settledWithin,
  startFlow,
  userPrompt,
} from '../../testing/flow.fake.js';
import { say, toolTurn, WORK_KINDS } from '../../testing/work-kinds.fake.js';
import type { WorkKind } from '../../testing/work-kinds.types.js';

// The rules are in `.agents/skills/sheavly/state-machines.md`, "The flow that must hold". A test
// marked `it.fails` states a rule today's code breaks: it turns red when the code is fixed.
// Rule 3 is fixed, so its tests are plain `it`.

afterEach(cancelOpenFlows);

const t1 = taskIdSchema.parse('t1');
const awaitFirst = toolTurn({
  id: 'w1',
  name: 'await_tasks',
  input: { ids: ['t1'], reason: 'Need its result.' },
});
const background = WORK_KINDS.filter((kind) => kind.background);
const awaitable = WORK_KINDS.filter((kind) => kind.background && kind.finite);

function startRun(params: {
  kind: WorkKind;
  turns: ReturnType<typeof say>[];
  signal?: AbortSignal;
  yieldSignal?: AbortSignal;
}) {
  const { kind, turns, signal, yieldSignal } = params;
  const flow = startFlow(kind);
  const { provider } = recordingProvider(turns);
  const run = runSession({
    ...flow.options,
    provider,
    messages: userPrompt(),
    ...(signal && { signal }),
    ...(yieldSignal && { yieldSignal }),
  });

  return { ...flow, run };
}

describe.each(background)('flow rules 1 and 4 — $name', (kind) => {
  const slowThenAnswer = () => [kind.start({ speed: 'slow', id: 'c1' }), say('Started.')];

  it('rule 1: the main session ends its turn when the model finishes, even while the work runs', async () => {
    const { run, tasks } = startRun({ kind, turns: slowThenAnswer() });

    expect(await settledWithin(run, SETTLES_MS)).toBe(true);
    expect(tasks.runningCount).toBe(1);
  });

  it('rule 4: a requested yield ends the turn at the model finishing, with the work still running', async () => {
    const yielding = new AbortController();

    yielding.abort();
    const { run, tasks } = startRun({
      kind,
      turns: slowThenAnswer(),
      yieldSignal: yielding.signal,
    });
    const result = await run;

    expect(result.reason).toBe('completed');
    expect(tasks.runningCount).toBe(1);
  });
});

describe.each(awaitable)('flow rules 2 and 3 — $name', (kind) => {
  const waiting = (speed: 'slow' | 'quick') => [
    kind.start({ speed, id: 'c1' }),
    awaitFirst,
    say('Waiting.'),
    say('Saw it.'),
  ];

  it('rule 2: await_tasks keeps the session open until the grouped work settles', async () => {
    const { run, tasks } = startRun({ kind, turns: waiting('slow') });

    expect(await settledWithin(run, HELD_MS)).toBe(false);
    expect(tasks.groupedPendingCount()).toBe(1);

    await tasks.cancel(t1);
    const result = await run;

    expect(result.reason).toBe('completed');
    expect(result.messages.at(-1)).toMatchObject({ content: 'Saw it.' });
  });

  it('rule 2: await_tasks ends with the finished work delivered when it settles by itself', async () => {
    const { run } = startRun({ kind, turns: waiting('quick') });
    const result = await run;

    // Work that finishes before the model's next call is delivered with that call, so the last
    // reply is not fixed; that the run ended with the notice delivered is.
    expect(result.reason).toBe('completed');
    expect(result.messages.filter((m) => m.role === 'notice')).toHaveLength(1);
  });

  it('rule 2: the user stopping the run ends the wait', async () => {
    const stopping = new AbortController();
    const { run } = startRun({ kind, turns: waiting('slow'), signal: stopping.signal });

    expect(await settledWithin(run, HELD_MS)).toBe(false);
    stopping.abort();

    expect((await run).reason).toBe('interrupted');
  });

  it('rule 3: a line queued while the session waits on await_tasks does not end the wait', async () => {
    const yielding = new AbortController();
    const { run } = startRun({ kind, turns: waiting('slow'), yieldSignal: yielding.signal });

    expect(await settledWithin(run, HELD_MS)).toBe(false);
    yielding.abort();

    expect(await settledWithin(run, HELD_MS)).toBe(false);
  });

  it('rule 3: a line queued before the model reaches await_tasks does not end the wait', async () => {
    const yielding = new AbortController();

    yielding.abort();
    const { run, tasks } = startRun({
      kind,
      turns: waiting('slow'),
      yieldSignal: yielding.signal,
    });

    expect(await settledWithin(run, HELD_MS)).toBe(false);
    expect(tasks.groupedPendingCount()).toBe(1);
  });

  it('rule 2: the user stopping the run still ends a wait that has a line queued', async () => {
    const stopping = new AbortController();
    const yielding = new AbortController();
    const { run } = startRun({
      kind,
      turns: waiting('slow'),
      signal: stopping.signal,
      yieldSignal: yielding.signal,
    });

    expect(await settledWithin(run, HELD_MS)).toBe(false);
    yielding.abort();
    expect(await settledWithin(run, HELD_MS)).toBe(false);
    stopping.abort();

    expect((await run).reason).toBe('interrupted');
  });

  it('rule 3: a line queued during the wait starts only after the model has seen the awaited result', async () => {
    const yielding = new AbortController();
    const { run, tasks } = startRun({
      kind,
      turns: waiting('slow'),
      yieldSignal: yielding.signal,
    });

    expect(await settledWithin(run, HELD_MS)).toBe(false);
    yielding.abort();
    await tasks.cancel(t1);
    const result = await run;

    expect(result.reason).toBe('completed');
    expect(result.messages.filter((m) => m.role === 'notice')).toHaveLength(1);
    expect(result.messages.at(-1)).toMatchObject({ content: 'Saw it.' });
    expect(tasks.hasDeliveries()).toBe(false);
  });

  it('rule 4: once the awaited work settles, a requested yield ends the run when the model finishes', async () => {
    const yielding = new AbortController();

    yielding.abort();
    const { run } = startRun({ kind, turns: waiting('quick'), yieldSignal: yielding.signal });
    const result = await run;

    expect(result.reason).toBe('completed');
  });
});

describe.each(WORK_KINDS.filter((kind) => kind.background && !kind.finite))(
  'flow rule 6 — $name',
  (kind) => {
    it('rule 6: a service never holds the run open', async () => {
      const { run } = startRun({
        kind,
        turns: [kind.start({ speed: 'slow', id: 'c1' }), say('Started.')],
      });

      expect(await settledWithin(run, SETTLES_MS)).toBe(true);
    });

    it('rule 6: only finite work can be awaited', async () => {
      const { run } = startRun({
        kind,
        turns: [kind.start({ speed: 'slow', id: 'c1' }), awaitFirst, say('Done.')],
      });
      const result = await run;
      const refusal = result.messages.find((m) => m.role === 'tool' && m.toolCallId === 'w1');

      expect(refusal).toMatchObject({ isError: true });
      expect(JSON.stringify(refusal)).toContain('service');
    });
  },
);
