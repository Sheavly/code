import { describe, expect, it } from 'vitest';
import { sessionInfoSchema } from '@sheavly/protocol/session/session.validator';
import { historyMessageSchema } from '@sheavly/protocol/history/history.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import {
  restoredReportNotices,
  storedOutcome,
  undeliveredAgents,
} from '../restored-reports.helper.js';

const MAIN = sessionIdSchema.parse('main-1');

function agent(id: string, extra: Record<string, unknown> = {}) {
  const fields = {
    id,
    parentId: MAIN,
    startedByCall: `call-${id}`,
    rootId: MAIN,
    depth: 2,
    title: `Agent ${id}`,
    state: 'completed',
    lastOutcome: 'completed',
    startedAt: 10,
    ...extra,
  };
  // An `undefined` in `extra` removes the field: the schema's optional fields are exact.
  const parsed = sessionInfoSchema.parse(
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  );

  if (!('parentId' in parsed)) throw new Error('not a sub-agent');

  return parsed;
}

const notice = (value: Record<string, unknown>) =>
  historyMessageSchema.parse({ role: 'notice', notice: value, at: 1 });

describe('undeliveredAgents', () => {
  it('finds an ended sub-agent whose report is not in history, oldest first', () => {
    const late = agent('b', { startedAt: 30 });
    const early = agent('a', { startedAt: 20 });
    const main = sessionInfoSchema.parse({
      id: MAIN,
      rootId: MAIN,
      depth: 1,
      title: 'x',
      state: 'idle',
      startedAt: 1,
    });

    expect(undeliveredAgents({ main: MAIN, sessions: [main, late, early], history: [] })).toEqual([
      early,
      late,
    ]);
  });

  it('skips one delivered by an agent-report for its session', () => {
    const history = [
      notice({ kind: 'agent-report', agent: agent('a'), outcome: 'completed', report: 'r' }),
    ];

    expect(undeliveredAgents({ main: MAIN, sessions: [agent('a')], history })).toEqual([]);
  });

  it('skips one delivered by a notice of its starting call, alone or in a group', () => {
    const finished = {
      kind: 'task-finished',
      task: {
        id: 't1',
        command: 'x',
        description: 'x',
        status: 'failed',
        output: '',
        startedAt: 1,
        callId: 'call-a',
      },
    };
    const grouped = {
      kind: 'tasks-finished',
      reason: 'wait',
      notices: [
        {
          kind: 'agent-report',
          agent: agent('z'),
          outcome: 'completed',
          report: 'r',
          context: {
            reason: 'x',
            startedAt: 1,
            durationMs: 0,
            userMessagesSinceStart: 0,
            callId: 'call-b',
          },
        },
      ],
    };
    const sessions = [agent('a'), agent('b')];

    expect(undeliveredAgents({ main: MAIN, sessions, history: [notice(finished)] })).toEqual([
      agent('b'),
    ]);
    expect(undeliveredAgents({ main: MAIN, sessions, history: [notice(grouped)] })).toEqual([
      agent('a'),
    ]);
  });

  it('ignores sub-agents of another session', () => {
    const nested = agent('n', { parentId: 'sub-a', depth: 3 });

    expect(undeliveredAgents({ main: MAIN, sessions: [nested], history: [] })).toEqual([]);
  });
});

describe('storedOutcome', () => {
  it('is how a run ended, and interrupted for one cut off while open', () => {
    expect(storedOutcome(agent('a', { state: 'failed', lastOutcome: 'failed' }))).toBe('failed');
    // A run cut off by the end of the process is interrupted, whatever an earlier run ended as.
    expect(storedOutcome(agent('a', { state: 'running' }))).toBe('interrupted');
    expect(storedOutcome(agent('a', { state: 'running', lastOutcome: undefined }))).toBe(
      'interrupted',
    );
  });
});

describe('restoredReportNotices', () => {
  it('gives a completed sub-agent its report and no task id', () => {
    const [entry] = restoredReportNotices({
      agents: [agent('a')],
      reports: new Map([[agent('a').id, 'THE REPORT']]),
      at: 99,
    });

    expect(entry).toMatchObject({
      role: 'notice',
      at: 99,
      notice: { kind: 'agent-report', outcome: 'completed', report: 'THE REPORT' },
    });
    expect(entry?.role === 'notice' && 'taskId' in entry.notice).toBe(false);
  });

  it('calls a completed sub-agent whose report could not be read back interrupted', () => {
    const [entry] = restoredReportNotices({ agents: [agent('a')], reports: new Map(), at: 1 });

    expect(entry).toMatchObject({
      notice: { outcome: 'interrupted', report: '', agent: { state: 'interrupted' } },
    });
  });

  it('gives a sub-agent that did not complete an empty report and its real outcome', () => {
    const cut = agent('a', { state: 'running', lastOutcome: undefined });
    const failed = agent('b', { state: 'failed', lastOutcome: 'failed' });
    const entries = restoredReportNotices({
      agents: [cut, failed],
      reports: new Map([
        [cut.id, 'ignored'],
        [failed.id, 'ignored'],
      ]),
      at: 1,
    });

    expect(entries).toMatchObject([
      { notice: { outcome: 'interrupted', report: '', agent: { state: 'interrupted' } } },
      { notice: { outcome: 'failed', report: '', agent: { state: 'failed' } } },
    ]);
  });
});
