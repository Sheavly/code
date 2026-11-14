import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { TaskRegistry } from '../tasks.service.js';
import { finiteWork, serviceWork, startWork } from '../work.utils.js';
import type { WorkInput } from '../work.types.js';

const owner = sessionIdSchema.parse('main');
const input: WorkInput = {
  command: 'cmd',
  description: 'work',
  sessionId: owner,
  run: ({ signal }) =>
    new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ exitCode: null }));
    }),
};

describe('background work kinds', () => {
  it('finite work holds its run; a service does not', async () => {
    const finite = new TaskRegistry();
    const services = new TaskRegistry();

    startWork({ tasks: finite, work: finiteWork(input) });
    startWork({ tasks: services, work: serviceWork(input) });

    expect(finite.hasPendingTasks()).toBe(true);
    expect(services.hasPendingTasks()).toBe(false);

    await finite.cancelAll();
    await services.cancelAll();
  });

  it('a kind decides the policy: the input cannot override it', () => {
    expect(finiteWork({ ...input, backgroundKind: 'service' } as WorkInput).backgroundKind).toBe(
      'task',
    );
    expect(serviceWork(input).backgroundKind).toBe('service');
  });

  it('work of every kind has an owner, so cancelSession stops it', async () => {
    const tasks = new TaskRegistry();

    startWork({ tasks, work: finiteWork(input) });
    startWork({ tasks, work: serviceWork(input) });

    await tasks.cancelSession(owner);

    expect(tasks.runningCount).toBe(0);
  });

  it('starts the work in the registry it is given', async () => {
    const tasks = new TaskRegistry();
    const started = startWork({ tasks, work: finiteWork(input) });

    expect(tasks.get(started.id)?.status).toBe('running');
    await tasks.cancelAll();
  });
});
