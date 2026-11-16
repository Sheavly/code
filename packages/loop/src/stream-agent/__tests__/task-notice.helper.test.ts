import { describe, expect, it } from 'vitest';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { taskInfoSchema } from '@sheavly/protocol/task/task.validator';
import { finishedTaskNotice } from '../task-notice.helper.js';

const PARENT = sessionIdSchema.parse('main-1');
const CHILD = {
  id: 'sub-1',
  parentId: PARENT,
  startedByCall: 'call-1',
  rootId: PARENT,
  depth: 2,
  title: 'Research',
  status: 'done',
  state: 'completed',
  startedAt: 1,
};

const task = (extra: Record<string, unknown> = {}) =>
  taskInfoSchema.parse({
    id: 't1',
    kind: 'task',
    command: 'ls',
    description: 'list',
    status: 'completed',
    output: '',
    startedAt: 1,
    ...extra,
  });

const registries = (report: string | undefined, children: object[]) => ({
  tasks: { report: () => report } as unknown as TaskRegistry,
  sessions: { children: () => children } as unknown as SessionRegistry,
  history: [],
});

describe('finishedTaskNotice', () => {
  it('is an agent-report with the whole report when the task started a sub-agent', () => {
    const notice = finishedTaskNotice({
      task: task({ callId: 'call-1' }),
      parent: PARENT,
      ...registries('THE WHOLE REPORT', [CHILD]),
    });

    expect(notice).toMatchObject({
      kind: 'agent-report',
      taskId: 't1',
      report: 'THE WHOLE REPORT',
    });
  });

  it('is a task-finished when no sub-agent started it, or it has no report', () => {
    const withCall = task({ callId: 'call-1' });

    expect(
      finishedTaskNotice({ task: withCall, parent: PARENT, ...registries('r', []) }).kind,
    ).toBe('task-finished');
    expect(
      finishedTaskNotice({ task: withCall, parent: PARENT, ...registries(undefined, [CHILD]) })
        .kind,
    ).toBe('task-finished');
  });

  it('takes the outcome from the task when the session has none: a cancelled one is interrupted', () => {
    const noOutcome = { ...CHILD, lastOutcome: undefined };
    const outcomeFor = (status: string) => {
      const notice = finishedTaskNotice({
        task: task({ callId: 'call-1', status }),
        parent: PARENT,
        ...registries('r', [noOutcome]),
      });

      return notice.kind === 'agent-report' ? notice.outcome : undefined;
    };

    expect(outcomeFor('completed')).toBe('completed');
    expect(outcomeFor('failed')).toBe('failed');
    expect(outcomeFor('cancelled')).toBe('interrupted');
  });

  it('does not pair a task with no call id with a child that has none either', () => {
    const orphan = { ...CHILD, startedByCall: undefined };
    const notice = finishedTaskNotice({
      task: task(),
      parent: PARENT,
      ...registries('r', [orphan]),
    });

    expect(notice.kind).toBe('task-finished');
  });
});
