import { describe, expect, it } from 'vitest';
import { agentEventSchema, entryEventSchema } from '../../event/event.validator.js';
import { historyMessageSchema, noticeMessageSchema } from '../../history/history.validator.js';
import { streamEntrySchema } from '../../stream/stream.validator.js';
import { contractJsonSchema } from '../../contract/contract.utils.js';
import {
  MAX_RUNNING_TASKS,
  MAX_RUNNING_TASK_TITLE_CHARS,
  MAX_RUNNING_TASK_REASON_CHARS,
} from '../notice.constants.js';
import {
  harnessNoticeSchema,
  persistentNoticeSchema,
  runningTaskSchema,
  runningTasksNoticeSchema,
} from '../notice.validator.js';

const task = { id: 't1', title: 'Check schemas', reason: 'Need validation results', startedAt: 0 };
const notice = { kind: 'running-tasks', tasks: [task], total: 1, omitted: 0 };

describe('transient running-task snapshots', () => {
  it('publishes literal bounds and accepts their exact boundaries', () => {
    expect([
      MAX_RUNNING_TASKS,
      MAX_RUNNING_TASK_TITLE_CHARS,
      MAX_RUNNING_TASK_REASON_CHARS,
    ]).toEqual([10, 200, 1000]);
    const tasks = Array.from({ length: MAX_RUNNING_TASKS }, (_, index) => ({
      ...task,
      id: `t${String(index)}`,
      title: 'x'.repeat(MAX_RUNNING_TASK_TITLE_CHARS),
      reason: 'x'.repeat(MAX_RUNNING_TASK_REASON_CHARS),
      group: 't0',
    }));
    const bounded = { ...notice, tasks, total: 13, omitted: 3 };

    expect(runningTasksNoticeSchema.parse(bounded)).toEqual(bounded);
    expect(harnessNoticeSchema.parse(bounded)).toEqual(bounded);
  });

  it('preserves an optional scalar group ID, even when the first requested member is omitted', () => {
    const grouped = {
      ...notice,
      tasks: [{ ...task, group: 'first-requested' }],
      total: 2,
      omitted: 1,
    };

    expect(harnessNoticeSchema.parse(grouped)).toEqual(grouped);
    expect(harnessNoticeSchema.parse(notice)).toEqual(notice);
    expect(runningTaskSchema.parse(task)).not.toHaveProperty('group');
  });

  it.each([
    { tasks: [], total: 0 },
    { tasks: Array.from({ length: MAX_RUNNING_TASKS + 1 }, () => task), total: 11 },
    { total: -1 },
    { omitted: -1, total: 0 },
    { total: 1.5 },
    { omitted: 0.5, total: 1.5 },
    { total: 2 },
    { omitted: 1 },
    { output: 'not part of this snapshot' },
    { command: 'not part of this snapshot' },
  ])('rejects invalid snapshots %j through the shared schema', (fields) => {
    expect(harnessNoticeSchema.safeParse({ ...notice, ...fields }).success).toBe(false);
  });

  it('preserves empty registry text and existing task ID semantics', () => {
    const emptyText = { ...notice, tasks: [{ ...task, id: '', title: '', reason: '', group: '' }] };

    expect(harnessNoticeSchema.parse(emptyText)).toEqual(emptyText);
  });

  it.each([
    { title: 'x'.repeat(MAX_RUNNING_TASK_TITLE_CHARS + 1) },
    { reason: 'x'.repeat(MAX_RUNNING_TASK_REASON_CHARS + 1) },
    { startedAt: -1 },
    { startedAt: 0.5 },
    { group: ['t1', 't2'] },
    { group: undefined },
    { output: 'secret output' },
    { command: 'secret command' },
  ])('rejects invalid entries %j', (fields) => {
    const invalid = { ...notice, tasks: [{ ...task, ...fields }] };

    expect(harnessNoticeSchema.safeParse(invalid).success).toBe(false);
    expect(
      agentEventSchema.safeParse({ type: 'harness_notice', seq: 0, notice: invalid }).success,
    ).toBe(false);
  });

  it('shares exactly the same payload in agent, entry and session-attributed stream events', () => {
    const event = { type: 'harness_notice', seq: 4, notice };
    const entry = { kind: 'event', sessionId: 's1', seq: 8, at: 100, event };

    expect(agentEventSchema.parse(event)).toEqual(event);
    expect(entryEventSchema.parse(event)).toEqual(event);
    expect(streamEntrySchema.parse(entry)).toEqual(entry);
  });

  it('cannot become persistent history or a nested completion notice', () => {
    const history = { role: 'notice', notice, at: 0 };

    expect(persistentNoticeSchema.safeParse(notice).success).toBe(false);
    expect(noticeMessageSchema.safeParse(history).success).toBe(false);
    expect(historyMessageSchema.safeParse(history).success).toBe(false);
    expect(
      persistentNoticeSchema.safeParse({
        kind: 'tasks-finished',
        reason: 'Wait',
        notices: [notice],
      }).success,
    ).toBe(false);
  });

  it('exports bounds and strict payload fields in JSON Schema', () => {
    const definitions = contractJsonSchema().$defs;

    expect(definitions.RunningTask).toMatchObject({
      additionalProperties: false,
      properties: {
        title: { maxLength: 200 },
        reason: { maxLength: 1000 },
        group: { $ref: '#/$defs/TaskId' },
        startedAt: { minimum: 0, type: 'integer' },
      },
    });
    expect(definitions.RunningTasksNotice).toMatchObject({
      additionalProperties: false,
      properties: {
        tasks: { minItems: 1, maxItems: 10 },
        total: { type: 'integer', minimum: 0 },
        omitted: { type: 'integer', minimum: 0 },
      },
    });
  });
});
