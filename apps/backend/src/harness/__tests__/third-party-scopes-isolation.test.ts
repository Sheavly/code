/**
 * Two extensions that declare the same grants own disjoint children and tasks: what one starts
 * the other cannot see, steer, report on or stop. The pair is a built-in with a third party, in
 * both orders, so who loaded first or declares an `origin` changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import { TaskError } from '@sheavly/runtime/errors/tasks.errors';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { scopeProbe } from '../../testing/scope-probe.fake.js';
import { PROBE_KINDS } from '../../testing/testing.constants.js';

const open = useBackendRuns();

describe.each([
  {
    label: 'a built-in and a third-party extension',
    origins: PROBE_KINDS.map((kind) => kind.origin),
  },
  {
    label: 'a third-party and a built-in extension',
    origins: PROBE_KINDS.map((kind) => kind.origin).reverse(),
  },
])('$label with the same grants', ({ origins }) => {
  const openPair = async () => {
    const alpha = scopeProbe({ name: 'alpha', origin: origins[0] });
    const beta = scopeProbe({ name: 'beta', origin: origins[1] });
    const harness = await open({ extensions: [alpha.extension, beta.extension] });

    return { alpha, beta, harness, main: harness.mainSession.id };
  };

  it('keeps the children one started out of the other’s reach', async () => {
    const { alpha, beta, main } = await openPair();
    const owned = alpha.scopes().child.startChild({
      parentId: main,
      startedByCall: callIdSchema.parse('a1'),
      title: 'alpha child',
    });
    const other = beta.scopes().child;

    expect(() =>
      other.startChild({
        parentId: owned.id,
        startedByCall: callIdSchema.parse('b1'),
        title: 'under alpha',
      }),
    ).toThrow(SessionError);
    expect(() => other.send({ id: owned.id, content: 'x', from: main })).toThrow(SessionError);
    expect(() => other.report({ id: owned.id, status: 'x' })).toThrow(SessionError);
    expect(() => other.setModel({ id: owned.id, modelId: 'm' as never })).toThrow(SessionError);
    await expect(other.runChild({ child: owned } as never)).rejects.toThrow(SessionError);
  });

  it('tells each only the updates of its own children', async () => {
    const { alpha, beta, main } = await openPair();
    const heardAlpha: SessionUpdate[] = [];
    const heardBeta: SessionUpdate[] = [];

    alpha.scopes().child.onUpdate((update) => heardAlpha.push(update));
    beta.scopes().child.onUpdate((update) => heardBeta.push(update));

    const owned = alpha.scopes().child.startChild({
      parentId: main,
      startedByCall: callIdSchema.parse('a1'),
      title: 'alpha child',
    });

    alpha.scopes().child.report({ id: owned.id, status: 'working' });

    expect(heardAlpha.map((update) => update.type)).toContain('session_status');
    expect(heardBeta).toEqual([]);
  });

  it('lists, reads, cancels and observes only the tasks it started', async () => {
    const { alpha, beta, harness, main } = await openPair();
    const heardByAlpha: string[] = [];

    alpha.scopes().tasks.observe(({ update }) => heardByAlpha.push(update.task.id));

    const first = alpha.startWaiting(main);
    const second = beta.startWaiting(main);

    expect(
      alpha
        .scopes()
        .tasks.list()
        .map((task) => task.id),
    ).toEqual([first.id]);
    expect(
      beta
        .scopes()
        .tasks.list()
        .map((task) => task.id),
    ).toEqual([second.id]);
    expect(heardByAlpha).toEqual([first.id]);
    expect(alpha.scopes().tasks.get(second.id)).toBeUndefined();
    await expect(alpha.scopes().tasks.cancel(second.id)).resolves.toBeUndefined();
    expect(() =>
      alpha.scopes().tasks.group({ ids: [first.id, second.id], reason: 'x', sessionId: main }),
    ).toThrow(TaskError);
    expect(harness.tasks.get(second.id)?.status).toBe('running');

    await alpha.scopes().tasks.cancel(first.id);
    await beta.scopes().tasks.cancel(second.id);

    expect(harness.tasks.get(first.id)?.status).toBe('cancelled');
    expect(harness.tasks.get(second.id)?.status).toBe('cancelled');
  });
});
