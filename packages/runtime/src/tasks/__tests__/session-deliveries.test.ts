import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { TaskError } from '../../errors/tasks.errors.js';
import { TaskRegistry } from '../tasks.service.js';
import type { StartTask } from '../tasks.types.js';

const owner = sessionIdSchema.parse('parent');
const other = sessionIdSchema.parse('parent/child');

function sessionTask(params: {
  registry: TaskRegistry;
  sessionId?: StartTask['sessionId'];
  backgroundKind?: StartTask['backgroundKind'];
}) {
  const outcome = Promise.withResolvers<{ exitCode: number | null }>();
  const task = params.registry.start({
    command: 'session work',
    description: 'Session work',
    ...(params.sessionId !== undefined && { sessionId: params.sessionId }),
    ...(params.backgroundKind !== undefined && { backgroundKind: params.backgroundKind }),
    run: ({ signal }) => {
      signal.addEventListener('abort', () => outcome.resolve({ exitCode: null }), { once: true });

      return outcome.promise;
    },
  });

  return {
    task,
    complete: async () => {
      const wake = params.registry.nextSettled();

      outcome.resolve({ exitCode: 0 });
      await wake;
    },
  };
}

function ownershipFixture() {
  const registry = new TaskRegistry();

  return {
    registry,
    generic: sessionTask({ registry }),
    owned: sessionTask({ registry, sessionId: owner }),
    foreign: sessionTask({ registry, sessionId: other }),
  };
}

describe('session-filtered task deliveries', () => {
  it('keeps generic-only groups shared even when registration validates a session', async () => {
    const registry = new TaskRegistry();
    const generic = sessionTask({ registry });

    registry.group({ ids: [generic.task.id], reason: 'Shared outcome', sessionId: owner });
    await generic.complete();
    expect(registry.takeDeliveries(other)).toEqual([
      { reason: 'Shared outcome', tasks: [registry.get(generic.task.id)] },
    ]);
    expect(registry.takeDeliveries(owner)).toEqual([]);
  });

  it('requires an unscoped consumer for an unscoped group spanning different owners', async () => {
    const { registry, generic, owned, foreign } = ownershipFixture();

    registry.group({ ids: [owned.task.id, foreign.task.id], reason: 'Administrative comparison' });
    await owned.complete();
    await foreign.complete();
    expect(registry.takeDeliveries(owner)).toEqual([]);
    expect(registry.takeDeliveries(other)).toEqual([]);
    expect(registry.takeDeliveries()).toEqual([
      {
        reason: 'Administrative comparison',
        tasks: [registry.get(owned.task.id), registry.get(foreign.task.id)],
      },
    ]);
    await registry.cancel(generic.task.id);
  });

  it('includes generic tasks in a scoped drain but leaves different owned sessions untouched', async () => {
    const registry = new TaskRegistry();
    const foreign = sessionTask({ registry, sessionId: other });
    const generic = sessionTask({ registry });
    const owned = sessionTask({ registry, sessionId: owner });

    await foreign.complete();
    await generic.complete();
    await owned.complete();

    expect(registry.hasDeliveries(owner)).toBe(true);
    expect(registry.hasPendingTasks(owner)).toBe(true);
    expect(registry.takeDeliveries(owner)).toEqual([
      { tasks: [registry.get(generic.task.id)] },
      { tasks: [registry.get(owned.task.id)] },
    ]);
    expect(registry.hasDeliveries(owner)).toBe(false);
    expect(registry.hasPendingTasks(owner)).toBe(false);
    expect(registry.takeDeliveries(owner)).toEqual([]);
    expect(registry.hasDeliveries(other)).toBe(true);
    expect(registry.hasPendingTasks(other)).toBe(true);
    expect(registry.hasDeliveries()).toBe(true);
    expect(registry.hasPendingTasks()).toBe(true);
    expect(registry.takeDeliveries()).toEqual([{ tasks: [registry.get(foreign.task.id)] }]);
    expect(registry.hasPendingTasks()).toBe(false);
  });

  it('delivers an owned group with generic members only to its allowed session', async () => {
    const { registry, generic, owned, foreign } = ownershipFixture();

    registry.group({
      ids: [generic.task.id, owned.task.id],
      reason: 'Owner results',
      sessionId: owner,
    });
    await generic.complete();
    await foreign.complete();

    expect(registry.hasDeliveries(owner)).toBe(false);
    expect(registry.takeDeliveries(other)).toEqual([{ tasks: [registry.get(foreign.task.id)] }]);
    expect(registry.hasPendingTasks(owner)).toBe(true);
    expect(registry.hasPendingTasks(other)).toBe(false);

    await owned.complete();

    expect(registry.hasDeliveries(other)).toBe(false);
    expect(registry.takeDeliveries(other)).toEqual([]);
    expect(registry.takeDeliveries(owner)).toEqual([
      {
        reason: 'Owner results',
        tasks: [registry.get(generic.task.id), registry.get(owned.task.id)],
      },
    ]);
    expect(registry.hasPendingTasks(owner)).toBe(false);
  });

  it('rejects foreign ownership synchronously and atomically even after valid generic and owned IDs', async () => {
    const { registry, generic, owned, foreign } = ownershipFixture();

    await generic.complete();

    const request = () =>
      registry.group({
        ids: [generic.task.id, owned.task.id, foreign.task.id],
        reason: 'Not allowed',
        sessionId: owner,
      });

    expect(request).toThrow(TaskError);
    expect(request).toThrow(
      expect.objectContaining({ reason: 'task_not_owned', taskId: foreign.task.id }),
    );
    expect(registry.list().every((task) => task.reason === undefined)).toBe(true);
    expect(registry.hasDeliveries(owner)).toBe(true);

    registry.group({
      ids: [generic.task.id, owned.task.id],
      reason: 'Valid retry',
      sessionId: owner,
    });
    await foreign.complete();
    await owned.complete();

    expect(registry.takeDeliveries(other)).toEqual([{ tasks: [registry.get(foreign.task.id)] }]);
    expect(registry.takeDeliveries(owner)).toEqual([
      {
        reason: 'Valid retry',
        tasks: [registry.get(generic.task.id), registry.get(owned.task.id)],
      },
    ]);
  });
});

describe('session-scoped services and grouped counts', () => {
  it('rejects an owned service, and reports a foreign one as foreign, not as a service', () => {
    const registry = new TaskRegistry();
    const finite = sessionTask({ registry, sessionId: owner });
    const service = sessionTask({ registry, sessionId: owner, backgroundKind: 'service' });
    const foreign = sessionTask({ registry, sessionId: other, backgroundKind: 'service' });

    expect(() =>
      registry.group({ ids: [finite.task.id, service.task.id], reason: 'x', sessionId: owner }),
    ).toThrow(expect.objectContaining({ reason: 'service_task' }));
    expect(() => registry.group({ ids: [foreign.task.id], reason: 'x', sessionId: owner })).toThrow(
      expect.objectContaining({ reason: 'task_not_owned' }),
    );
    expect(registry.groupedPendingCount(owner)).toBe(0);
  });

  it('counts only the asking session’s grouped tasks', () => {
    const registry = new TaskRegistry();
    const mine = sessionTask({ registry, sessionId: owner });
    const theirs = sessionTask({ registry, sessionId: other });

    registry.group({ ids: [mine.task.id], reason: 'Mine', sessionId: owner });
    registry.group({ ids: [theirs.task.id], reason: 'Theirs', sessionId: other });

    expect(registry.groupedPendingCount(owner)).toBe(1);
    expect(registry.groupedPendingCount(other)).toBe(1);
  });
});

describe('session-scoped pending work and cancellation', () => {
  it('counts default finite work and completed services, but exempts running services by session', async () => {
    const registry = new TaskRegistry();
    const foreign = sessionTask({ registry, sessionId: other });
    const service = sessionTask({ registry, sessionId: owner, backgroundKind: 'service' });

    expect(registry.hasPendingTasks(owner)).toBe(false);
    expect(registry.hasPendingTasks(other)).toBe(true);
    expect(registry.hasPendingTasks()).toBe(true);

    const generic = sessionTask({ registry });

    expect(registry.hasPendingTasks(owner)).toBe(true);

    await generic.complete();
    registry.takeDeliveries(owner);

    expect(registry.hasPendingTasks(owner)).toBe(false);

    await service.complete();

    expect(registry.hasPendingTasks(owner)).toBe(true);
    expect(registry.hasDeliveries(owner)).toBe(true);
    expect(registry.takeDeliveries(owner)).toEqual([{ tasks: [registry.get(service.task.id)] }]);
    expect(registry.hasPendingTasks(owner)).toBe(false);
    expect(registry.hasPendingTasks(other)).toBe(true);

    await registry.cancel(foreign.task.id);
  });

  it('cancels exact ownership, never generic work or a child session, including owned services', async () => {
    const registry = new TaskRegistry();
    const owned = sessionTask({ registry, sessionId: owner });
    const service = sessionTask({ registry, sessionId: owner, backgroundKind: 'service' });
    const generic = sessionTask({ registry });
    const child = sessionTask({ registry, sessionId: other });

    await registry.cancelSession(sessionIdSchema.parse('unknown'));

    expect(registry.runningCount).toBe(4);

    await registry.cancelSession(owner);

    expect(registry.get(owned.task.id)?.status).toBe('cancelled');
    expect(registry.get(service.task.id)?.status).toBe('cancelled');
    expect(registry.get(generic.task.id)?.status).toBe('running');
    expect(registry.get(child.task.id)?.status).toBe('running');
    expect(registry.hasDeliveries(owner)).toBe(false);
    expect(registry.hasPendingTasks(owner)).toBe(true);
    expect(registry.runningCount).toBe(2);

    await registry.cancelSession(owner);

    expect(registry.runningCount).toBe(2);

    await registry.cancelAll();

    expect(registry.hasPendingTasks()).toBe(false);
  });

  it('keeps owned grouped cancellations held until generic work settles without cancelling it', async () => {
    const registry = new TaskRegistry();
    const owned = sessionTask({ registry, sessionId: owner });
    const generic = sessionTask({ registry });

    registry.group({
      ids: [owned.task.id, generic.task.id],
      reason: 'Both outcomes',
      sessionId: owner,
    });
    await registry.cancelSession(owner);

    expect(registry.get(owned.task.id)?.status).toBe('cancelled');
    expect(registry.get(generic.task.id)?.status).toBe('running');
    expect(registry.hasDeliveries(owner)).toBe(false);
    expect(registry.release(owned.task.id)).toBe(false);

    await generic.complete();

    expect(registry.takeDeliveries(other)).toEqual([]);
    expect(registry.takeDeliveries(owner)).toEqual([
      {
        reason: 'Both outcomes',
        tasks: [registry.get(owned.task.id), registry.get(generic.task.id)],
      },
    ]);
    expect(registry.release(owned.task.id)).toBe(true);
  });
});
