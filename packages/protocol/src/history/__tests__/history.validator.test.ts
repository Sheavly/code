import { describe, expect, it } from 'vitest';
import { harnessNoticeSchema, persistentNoticeSchema } from '../../notice/notice.validator.js';
import { messageSchema } from '../../message/message.validator.js';
import { entryEventSchema } from '../../event/event.validator.js';
import { historyMessageSchema, noticeMessageSchema } from '../history.validator.js';

const agent = {
  id: 'sub-1',
  parentId: 'main-1',
  startedByCall: 'call-1',
  rootId: 'main-1',
  depth: 2,
  title: 'Research the cache',
  status: 'reading files',
  state: 'completed',
  lastOutcome: 'completed',
  startedAt: 10,
  endedAt: 20,
};
const report = {
  kind: 'agent-report',
  agent,
  taskId: 't1',
  outcome: 'completed',
  report: 'REPORT-BEGIN\n'.concat('Finding: x\n'.repeat(900), 'REPORT-END'),
};
const finished = {
  kind: 'task-finished',
  task: {
    id: 't2',
    command: 'npm test',
    description: 'running tests',
    status: 'completed',
    exitCode: 0,
    startedAt: 1,
    endedAt: 4,
    output: 'ok',
  },
};

describe('persistent notices', () => {
  it('carry a sub-agent card and its whole report as typed data', () => {
    expect(persistentNoticeSchema.parse(report)).toEqual(report);
  });

  it('keep the report unbounded, so a long one is not shortened on the wire', () => {
    const parsed = persistentNoticeSchema.parse(report);

    expect(parsed.kind === 'agent-report' && parsed.report.length).toBe(report.report.length);
  });

  it('carry a finished task with its bounded output preview', () => {
    expect(persistentNoticeSchema.parse(finished)).toEqual(finished);
  });

  it('reject a sub-agent that has no parent, an unknown outcome, and prose', () => {
    const { parentId: _removed, ...orphan } = agent;

    expect(persistentNoticeSchema.safeParse({ ...report, agent: orphan }).success).toBe(false);
    expect(persistentNoticeSchema.safeParse({ ...report, outcome: 'running' }).success).toBe(false);
    expect(persistentNoticeSchema.safeParse('the agent finished').success).toBe(false);
  });

  it('are part of the shared notice contract, beside the transient kinds', () => {
    expect(harnessNoticeSchema.safeParse(report).success).toBe(true);
    expect(
      harnessNoticeSchema.safeParse({ kind: 'context-usage', context: { used: 1 } }).success,
    ).toBe(true);
  });

  it('travel on the event stream with the same payload they are stored with', () => {
    const event = { type: 'harness_notice', seq: 3, notice: report };

    expect(entryEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
});

describe('a notice in history', () => {
  const entry = { role: 'notice', notice: report, at: 5 };

  it('is stored as typed data, with when it was written', () => {
    expect(noticeMessageSchema.parse(entry)).toEqual(entry);
    expect(historyMessageSchema.parse(entry)).toEqual(entry);
  });

  it('is never sent to a model as it is: the model schema refuses the role', () => {
    expect(messageSchema.safeParse(entry).success).toBe(false);
  });

  it('carries no id, so it cannot pass for a prompt a person typed', () => {
    expect(
      noticeMessageSchema.parse({ ...entry, id: 'a8a4d1c0-1b1e-4d2a-9d6b-1f6c3d0f5a11' }),
    ).toEqual(entry);
  });

  it('refuses a transient kind: those are never stored', () => {
    const transient = { role: 'notice', notice: { kind: 'context-usage', context: { used: 5 } } };

    expect(historyMessageSchema.safeParse(transient).success).toBe(false);
  });

  it('keeps every other role readable, so older histories still load', () => {
    expect(historyMessageSchema.safeParse({ role: 'user', content: 'hi' }).success).toBe(true);
    expect(
      historyMessageSchema.safeParse({
        role: 'user',
        content: 'Background task finished:\n[task t1 · completed · exit code 0 · 1.0s] $ ls',
      }).success,
    ).toBe(true);
  });
});
