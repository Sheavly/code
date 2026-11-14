import { describe, expect, it } from 'vitest';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import type { TaskId } from '@sheavly/protocol/task/task.types';
import { until } from '@sheavly/testing/wait/until.fake';
import { SessionRegistry } from '../../sessions/sessions.service.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';
import { TaskRegistry } from '../tasks.service.js';

const STEPS = 30;
const FINISHED_PER_STEP = 4;
const KEEP_EVERY = 5;

/**
 * Many model steps, each starting finished work and a sub-agent, and every fifth step one task and
 * one sub-agent that keep running. A step boundary reports and releases what finished, as the
 * loop does before a model call.
 */
describe('the registries over a long run', () => {
  it('hold only the unfinished work, however many tasks and sub-agents came and went', async () => {
    const tasks = new TaskRegistry();
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });
    const children = new Map<TaskId, SessionRef>();
    let kept = 0;
    let largest = 0;

    const startAgent = (finishes: boolean) => {
      const child = sessions.startChild({
        parentId: main.id,
        startedByCall: STARTED_BY,
        title: 'Agent',
      });
      const never = Promise.withResolvers<{ exitCode: number }>();
      const { id } = tasks.start({
        command: 'sub-agent',
        description: 'agent',
        sessionId: main.id,
        run: () => (finishes ? Promise.resolve({ exitCode: 0 }) : never.promise),
      });

      if (finishes) sessions.end({ id: child.id, state: 'completed' });
      children.set(id, child);
    };

    for (let step = 1; step <= STEPS; step++) {
      for (let index = 0; index < FINISHED_PER_STEP; index++) {
        tasks.start({
          command: 'cmd',
          description: 'work',
          sessionId: main.id,
          run: () => Promise.resolve({ exitCode: 0 }),
        });
      }

      startAgent(true);

      if (step % KEEP_EVERY === 0) {
        kept += 2;
        tasks.start({
          command: 'server',
          description: 'long',
          sessionId: main.id,
          run: () => new Promise(() => undefined),
        });
        startAgent(false);
      }

      await until(() => tasks.runningCount === kept);

      // The step boundary: deliver, then release the tasks and the sub-agent sessions they started.
      const delivered = tasks.takeDeliveries(main.id).flatMap((delivery) => delivery.tasks);

      tasks.releaseFinished(main.id);

      for (const { id } of delivered) {
        const child = children.get(id);

        if (child) sessions.releaseAgent(child.id);
      }

      largest = Math.max(largest, tasks.list().length);
    }

    expect(largest).toBeLessThanOrEqual(kept);
    expect(tasks.list()).toHaveLength(kept);
    expect(tasks.list().every((task) => task.status === 'running')).toBe(true);
    // The main session and the sub-agents still running; every delivered one was released.
    expect(sessions.list()).toHaveLength(1 + kept / 2);
  });
});
