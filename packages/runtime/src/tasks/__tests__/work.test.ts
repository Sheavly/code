import { describe, expect, it } from 'vitest';
import { TaskRegistry } from '../tasks.service.js';
import { finiteWork, serviceWork, startWork } from '../work.utils.js';
import type { WorkInput } from '../work.types.js';

const input: WorkInput = {
  command: 'cmd',
  description: 'work',
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

  it('starts the work in the registry it is given', async () => {
    const tasks = new TaskRegistry();
    const started = startWork({ tasks, work: finiteWork(input) });

    expect(tasks.get(started.id)?.status).toBe('running');
    await tasks.cancelAll();
  });
});
