import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { taskIdSchema } from '@sheavly/protocol/task/task.validator';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { TaskError } from '../../errors/tasks.errors.js';
import { TaskRegistry } from '../tasks.service.js';
import type { StartTask } from '../tasks.types.js';

const parent = sessionIdSchema.parse('parent');
const child = sessionIdSchema.parse('parent/child');

function runningTask(params: {
  registry: TaskRegistry;
  description?: string;
  sessionId?: StartTask['sessionId'];
  backgroundKind?: StartTask['backgroundKind'];
}) {
  const outcome = Promise.withResolvers<{ exitCode: number | null; report?: string }>();
  const task = params.registry.start({
    command: 'private command arguments',
    description: params.description ?? 'Task title',
    callId: callIdSchema.parse('private-call'),
    sessionId: params.sessionId,
    ...(params.backgroundKind && { backgroundKind: params.backgroundKind }),
    run: ({ signal, onOutput }) => {
      onOutput('private progress output');
      signal.addEventListener('abort', () => outcome.resolve({ exitCode: null }), { once: true });

      return outcome.promise;
    },
  });

  return {
    task,
    complete: async (exitCode = 0) => {
      const settled = params.registry.nextSettled();

      outcome.resolve({ exitCode, report: 'private whole report' });
      await settled;
    },
  };
}

describe('running task metadata snapshots', () => {
  const clock = useFixedClock();

  it('returns fresh metadata only, with descriptions as titles and fallback reasons', async () => {
    const registry = new TaskRegistry();
    const member = runningTask({ registry });
    const expected = {
      id: member.task.id,
      title: 'Task title',
      reason: 'Task title',
      startedAt: clock.at,
    };
    const first = registry.runningTasks();
    const second = registry.runningTasks();

    expect(first).toEqual([expected]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).not.toBe(member.task);

    const snapshot = first[0];

    if (snapshot) {
      snapshot.title = 'Caller title';
      snapshot.reason = 'Caller reason';
      snapshot.startedAt = 1;
      snapshot.id = taskIdSchema.parse('caller-id');
      snapshot.group = taskIdSchema.parse('caller-group');
    }

    first.length = 0;
    member.task.description = 'Changed start snapshot';
    expect(registry.runningTasks()).toEqual([expected]);
    expect(second).toEqual([expected]);
    expect(registry.get(expected.id)?.description).toBe('Task title');
    expect(registry.get(expected.id)).not.toHaveProperty('reason');
    await registry.cancelAll();
  });

  it('uses the first requested member ID even after it settles, never a shared ID array', async () => {
    const registry = new TaskRegistry();
    const first = runningTask({ registry, description: 'Started first' });
    const anchor = runningTask({ registry, description: 'Requested first' });
    const single = runningTask({ registry, description: 'Ungrouped' });
    const ids = [anchor.task.id, first.task.id];

    registry.group({ ids, reason: 'Compare results' });
    ids.reverse();
    expect(registry.runningTasks()).toEqual([
      {
        id: first.task.id,
        title: 'Started first',
        reason: 'Compare results',
        startedAt: clock.at,
        group: anchor.task.id,
      },
      {
        id: anchor.task.id,
        title: 'Requested first',
        reason: 'Compare results',
        startedAt: clock.at,
        group: anchor.task.id,
      },
      { id: single.task.id, title: 'Ungrouped', reason: 'Ungrouped', startedAt: clock.at },
    ]);
    await anchor.complete();
    expect(registry.runningTasks()[0]?.group).toBe(anchor.task.id);
    expect(registry.release(anchor.task.id)).toBe(false);
    expect(registry.takeDeliveries()).toEqual([]);
    await registry.cancelAll();
  });

  it('preserves an explicitly empty group reason instead of replacing it with the description', async () => {
    const registry = new TaskRegistry();
    const member = runningTask({ registry });

    registry.group({ ids: [member.task.id], reason: '' });
    expect(registry.runningTasks()[0]?.reason).toBe('');
    await registry.cancelAll();
  });

  it('includes services, excludes every settled status, and does not consume completions', async () => {
    const registry = new TaskRegistry();
    const completed = runningTask({ registry });
    const failed = runningTask({ registry });
    const cancelled = runningTask({ registry });
    const service = runningTask({ registry, backgroundKind: 'service' });

    await completed.complete();
    await failed.complete(1);
    await registry.cancel(cancelled.task.id);
    expect(registry.hasPendingTasks()).toBe(true);
    expect(registry.runningTasks().map((task) => task.id)).toEqual([service.task.id]);
    expect(registry.runningTasks().map((task) => task.id)).toEqual([service.task.id]);
    expect(
      registry.takeDeliveries().flatMap((delivery) => delivery.tasks.map((task) => task.id)),
    ).toEqual([completed.task.id, failed.task.id]);
    expect(registry.hasPendingTasks()).toBe(false);
    expect(registry.runningTasks()).toHaveLength(1);
    await registry.cancelAll();
    expect(registry.runningTasks()).toEqual([]);
  });

  it('does not impose notice count or text limits', async () => {
    const registry = new TaskRegistry();
    const description = 'Long description '.repeat(1000);
    const members = Array.from({ length: 12 }, () => runningTask({ registry, description }));
    const reason = 'Long wait reason '.repeat(1000);

    registry.group({ ids: members.map((member) => member.task.id), reason });
    expect(registry.runningTasks()).toHaveLength(12);
    expect(
      registry.runningTasks().every((task) => task.title === description && task.reason === reason),
    ).toBe(true);
    await registry.cancelAll();
  });
});

describe('running task session visibility', () => {
  it('includes generic tasks and exact ownership, not parents, children or unknown sessions', async () => {
    const registry = new TaskRegistry();
    const generic = runningTask({ registry });
    const owned = runningTask({ registry, sessionId: parent });
    const descendant = runningTask({ registry, sessionId: child, backgroundKind: 'service' });

    expect(registry.runningTasks(parent).map((task) => task.id)).toEqual([
      generic.task.id,
      owned.task.id,
    ]);
    expect(registry.runningTasks(child).map((task) => task.id)).toEqual([
      generic.task.id,
      descendant.task.id,
    ]);
    expect(registry.runningTasks(sessionIdSchema.parse('unknown')).map((task) => task.id)).toEqual([
      generic.task.id,
    ]);
    expect(registry.runningTasks().map((task) => task.id)).toEqual([
      generic.task.id,
      owned.task.id,
      descendant.task.id,
    ]);
    await registry.cancelAll();
  });

  it('shares generic-only group metadata even when registration validates an owner', async () => {
    const registry = new TaskRegistry();
    const generic = runningTask({ registry });

    registry.group({ ids: [generic.task.id], reason: 'Shared reason', sessionId: parent });
    expect(registry.runningTasks(child)[0]).toMatchObject({
      group: generic.task.id,
      reason: 'Shared reason',
    });
    await registry.cancelAll();
  });

  it('hides mixed-owned group IDs and reasons but retains compatible tasks', async () => {
    const registry = new TaskRegistry();
    const generic = runningTask({ registry, description: 'Shared work' });
    const owned = runningTask({ registry, sessionId: parent, description: 'Parent work' });
    const foreign = runningTask({ registry, sessionId: child, description: 'Child work' });
    const reason = 'Confidential combined context';

    registry.group({ ids: [foreign.task.id, generic.task.id, owned.task.id], reason });
    expect(registry.runningTasks(parent)).toEqual([
      {
        id: generic.task.id,
        title: 'Shared work',
        reason: 'Shared work',
        startedAt: generic.task.startedAt,
      },
      {
        id: owned.task.id,
        title: 'Parent work',
        reason: 'Parent work',
        startedAt: owned.task.startedAt,
      },
    ]);
    expect(registry.runningTasks(child).map((task) => task.reason)).toEqual([
      'Shared work',
      'Child work',
    ]);
    expect(registry.runningTasks(child).every((task) => !('group' in task))).toBe(true);
    expect(
      registry
        .runningTasks()
        .every((task) => task.group === foreign.task.id && task.reason === reason),
    ).toBe(true);
    expect(registry.get(owned.task.id)?.reason).toBe(reason);
    await foreign.complete();
    expect(
      registry.runningTasks(parent).every((task) => !('group' in task) && task.reason !== reason),
    ).toBe(true);
    await registry.cancelAll();
  });

  it('exposes a generic/owned group to its owner but not its shared context to a child', async () => {
    const registry = new TaskRegistry();
    const generic = runningTask({ registry });
    const owned = runningTask({ registry, sessionId: parent });

    registry.group({
      ids: [owned.task.id, generic.task.id],
      reason: 'Parent context',
      sessionId: parent,
    });
    expect(
      registry
        .runningTasks(parent)
        .every((task) => task.group === owned.task.id && task.reason === 'Parent context'),
    ).toBe(true);
    expect(registry.runningTasks(child)).toEqual([
      {
        id: generic.task.id,
        title: 'Task title',
        reason: 'Task title',
        startedAt: generic.task.startedAt,
      },
    ]);
    await registry.cancelAll();
  });

  it('keeps snapshots unchanged after rejected groups, including ownership and late validation errors', async () => {
    const registry = new TaskRegistry();
    const generic = runningTask({ registry });
    const owned = runningTask({ registry, sessionId: parent });
    const foreign = runningTask({ registry, sessionId: child });
    const before = registry.runningTasks();
    const invalidGroups = [
      [],
      [generic.task.id, owned.task.id, foreign.task.id],
      [generic.task.id, owned.task.id, generic.task.id],
      [generic.task.id, owned.task.id, taskIdSchema.parse('unknown')],
    ];

    for (const ids of invalidGroups) {
      expect(() => registry.group({ ids, reason: 'Rejected context', sessionId: parent })).toThrow(
        TaskError,
      );
      expect(registry.runningTasks()).toEqual(before);
      expect(registry.list().every((task) => task.reason === undefined)).toBe(true);
    }

    registry.group({ ids: [owned.task.id], reason: 'Valid context', sessionId: parent });
    const grouped = registry.runningTasks();

    expect(() =>
      registry.group({
        ids: [generic.task.id, owned.task.id],
        reason: 'Rejected retry',
        sessionId: parent,
      }),
    ).toThrow(TaskError);
    expect(registry.runningTasks()).toEqual(grouped);
    expect(registry.get(generic.task.id)).not.toHaveProperty('reason');
    await registry.cancelAll();
  });
});
