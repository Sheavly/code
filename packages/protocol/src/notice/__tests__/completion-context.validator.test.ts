import { describe, expect, it } from 'vitest';
import { contractJsonSchema } from '../../contract/contract.utils.js';
import { entryEventSchema } from '../../event/event.validator.js';
import { historyMessageSchema } from '../../history/history.validator.js';
import { harnessNoticeSchema, taskCompletionContextSchema } from '../notice.validator.js';

const CONTEXT = {
  reason: 'Use the results to choose the next step',
  startedAt: 100,
  durationMs: 100,
  userMessagesSinceStart: 2,
  callId: 'call-1',
};
const TASK = {
  id: 'task-1',
  kind: 'task',
  command: 'npm test',
  description: 'Run tests',
  status: 'completed',
  startedAt: 100,
  endedAt: 200,
  output: 'ok',
};
const AGENT_REPORT = {
  kind: 'agent-report',
  agent: {
    id: 'agent-1',
    parentId: 'main',
    rootId: 'main',
    startedByCall: 'call-1',
    depth: 2,
    title: 'Review tests',
    state: 'completed',
    startedAt: 100,
    endedAt: 200,
    lastOutcome: 'completed',
  },
  taskId: 'task-1',
  outcome: 'completed',
  report: 'All tests passed',
  context: CONTEXT,
};
const TASK_FINISHED = { kind: 'task-finished', task: TASK, context: CONTEXT };
const GROUP = {
  kind: 'tasks-finished',
  reason: 'Compare both results',
  notices: [AGENT_REPORT, TASK_FINISHED],
  context: CONTEXT,
};
const NOTICES = [AGENT_REPORT, TASK_FINISHED, GROUP];

describe('taskCompletionContextSchema', () => {
  it('preserves completion facts and the optional originating call', () => {
    expect(taskCompletionContextSchema.parse(CONTEXT)).toEqual(CONTEXT);
  });

  it.each([0, 0.5])('accepts nonnegative duration %j without requiring a call', (durationMs) => {
    const context = {
      reason: '',
      startedAt: 0,
      durationMs,
      userMessagesSinceStart: 0,
    };

    expect(taskCompletionContextSchema.parse(context)).toEqual(context);
    expect(taskCompletionContextSchema.parse(context)).not.toHaveProperty('callId');
  });

  it.each([
    { reason: undefined },
    { reason: null },
    { reason: 1 },
    { startedAt: undefined },
    { startedAt: -1 },
    { startedAt: 0.5 },
    { durationMs: undefined },
    { durationMs: -1 },
    { durationMs: Infinity },
    { durationMs: NaN },
    { userMessagesSinceStart: undefined },
    { userMessagesSinceStart: -1 },
    { userMessagesSinceStart: 0.5 },
    { callId: undefined },
    { callId: null },
    { callId: 1 },
  ])('rejects invalid completion facts %j in every notice kind', (invalid) => {
    const context = { ...CONTEXT, ...invalid };

    expect(taskCompletionContextSchema.safeParse(context).success).toBe(false);

    for (const notice of NOTICES) {
      expect(harnessNoticeSchema.safeParse({ ...notice, context }).success).toBe(false);
    }
  });
});

describe('completion notices', () => {
  it('round-trips every notice kind with its completion context', () => {
    for (const notice of NOTICES) {
      const history = { role: 'notice', notice, at: 200 };
      const event = { type: 'harness_notice', seq: 0, notice };

      expect(harnessNoticeSchema.parse(notice)).toEqual(notice);
      expect(historyMessageSchema.parse(JSON.parse(JSON.stringify(history)))).toEqual(history);
      expect(entryEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    }
  });

  it('requires the completion context in every notice kind, and in each group member', () => {
    const { context: _context, ...bareReport } = AGENT_REPORT;
    const { context: _unused, ...bareFinished } = TASK_FINISHED;
    const { context: _group, ...bareGroup } = GROUP;

    for (const notice of [bareReport, bareFinished, bareGroup]) {
      expect(harnessNoticeSchema.safeParse(notice).success).toBe(false);
    }

    expect(
      harnessNoticeSchema.safeParse({ ...GROUP, notices: [bareReport, TASK_FINISHED] }).success,
    ).toBe(false);
  });

  it('retains separate group and member contexts alongside the existing group reason', () => {
    const notice = {
      ...GROUP,
      notices: [
        { ...AGENT_REPORT, context: { ...CONTEXT, reason: 'Review report' } },
        {
          ...TASK_FINISHED,
          task: { ...TASK, reason: GROUP.reason },
          context: { ...CONTEXT, reason: GROUP.reason, durationMs: 50 },
        },
      ],
    };

    expect(harnessNoticeSchema.parse(notice)).toEqual(notice);
  });

  it.each([undefined, null])('rejects a present invalid context %j', (context) => {
    for (const notice of NOTICES) {
      expect(harnessNoticeSchema.safeParse({ ...notice, context }).success).toBe(false);
    }
  });

  it.each([
    { ...GROUP, notices: [] },
    { ...GROUP, notices: [GROUP] },
    { ...GROUP, notices: [{ kind: 'output-continuation', attempt: 1 }] },
    { ...GROUP, reason: undefined },
  ])('keeps the existing group contract restrictions for %j', (group) => {
    expect(harnessNoticeSchema.safeParse(group).success).toBe(false);
  });

  it('names the completion context in the generated contract for non-TypeScript clients', () => {
    expect(contractJsonSchema().$defs).toHaveProperty('TaskCompletionContext');
  });
});
