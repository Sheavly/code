import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { TaskRegistry } from '../tasks.service.js';

function reasonTask(tasks: TaskRegistry, callId: string) {
  const result = Promise.withResolvers<{ exitCode: number }>();
  const info = tasks.start({
    command: 'check',
    description: 'Check without inferred context',
    callId: callIdSchema.parse(callId),
    run: () => result.promise,
  });

  return {
    info,
    finish: async () => {
      const settled = tasks.nextSettled();

      result.resolve({ exitCode: 0 });
      await settled;
    },
  };
}

describe('task group reasons', () => {
  it('retains the explicit reason on running and already-settled members in every view', async () => {
    const tasks = new TaskRegistry();
    const settled = reasonTask(tasks, 'settled-call');
    const running = reasonTask(tasks, 'running-call');
    const reason = 'Compare both results before choosing the next step';

    await settled.finish();
    tasks.group({ ids: [running.info.id, settled.info.id], reason });

    expect(tasks.get(running.info.id)).toMatchObject({ status: 'running', reason });
    expect(tasks.get(settled.info.id)).toMatchObject({ status: 'completed', reason });
    expect(tasks.list().map((task) => task.reason)).toEqual([reason, reason]);
    expect(tasks.byCallId(callIdSchema.parse('running-call'))?.reason).toBe(reason);
    expect(tasks.byCallId(callIdSchema.parse('settled-call'))?.reason).toBe(reason);
    expect(tasks.takeDeliveries()).toEqual([]);

    await running.finish();
    const deliveries = tasks.takeDeliveries();

    expect(deliveries).toEqual([
      {
        reason,
        tasks: [
          expect.objectContaining({ id: running.info.id, status: 'completed', reason }),
          expect.objectContaining({ id: settled.info.id, status: 'completed', reason }),
        ],
      },
    ]);
    expect(tasks.get(running.info.id)?.reason).toBe(reason);
    expect(tasks.get(settled.info.id)?.reason).toBe(reason);
    expect(tasks.takeDeliveries()).toEqual([]);
  });

  it('isolates start, query and delivery snapshots from stored group reasons', async () => {
    const tasks = new TaskRegistry();
    const member = reasonTask(tasks, 'snapshot-call');
    const beforeGroup = tasks.get(member.info.id);
    const reason = 'Review this result before continuing';

    tasks.group({ ids: [member.info.id], reason });

    expect(member.info).not.toHaveProperty('reason');
    expect(beforeGroup).not.toHaveProperty('reason');

    const snapshots = [
      tasks.get(member.info.id),
      ...tasks.list(),
      tasks.byCallId(callIdSchema.parse('snapshot-call')),
    ];

    for (const snapshot of snapshots) {
      expect(snapshot?.reason).toBe(reason);
      if (snapshot) snapshot.reason = 'Changed by caller';
    }

    expect(tasks.get(member.info.id)?.reason).toBe(reason);
    await member.finish();
    const delivery = tasks.takeDeliveries()[0];

    expect(delivery?.reason).toBe(reason);
    expect(delivery?.tasks[0]?.reason).toBe(reason);

    if (delivery) {
      delivery.reason = 'Changed delivery context';
      const task = delivery.tasks[0];

      if (task) task.reason = 'Changed delivered task';
    }

    expect(tasks.get(member.info.id)?.reason).toBe(reason);
    expect(tasks.byCallId(callIdSchema.parse('snapshot-call'))?.reason).toBe(reason);
    expect(tasks.list()[0]?.reason).toBe(reason);
  });

  it('keeps ungrouped starts and completions free of inferred reasons', async () => {
    const tasks = new TaskRegistry();
    const single = reasonTask(tasks, 'single-call');

    expect(single.info).not.toHaveProperty('reason');
    expect(tasks.get(single.info.id)).not.toHaveProperty('reason');
    await single.finish();
    const deliveries = tasks.takeDeliveries();

    expect(deliveries).toEqual([{ tasks: [tasks.get(single.info.id)] }]);
    expect(deliveries[0]).not.toHaveProperty('reason');
    expect(deliveries[0]?.tasks[0]).not.toHaveProperty('reason');
  });
});
