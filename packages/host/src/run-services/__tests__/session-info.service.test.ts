import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { SESSION_INFO } from '@sheavly/extension/run-services/run-services.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { scopeRun } from '../../testing/scope-run.fake.js';

/** Starts a sub-agent under the run's main session, announced to every lifecycle listener. */
const startChildOf = (run: ReturnType<typeof scopeRun>) =>
  run.harness.sessions.startChild({
    parentId: run.harness.mainSession.id,
    startedByCall: callIdSchema.parse('c1'),
    title: 'child',
  });

const reader = { name: 'reader', requires: [SESSION_INFO.name], grants: ['session:read'] };
const blind = { name: 'blind', requires: [SESSION_INFO.name], grants: [] };

describe('the session-info service', () => {
  it('reads the run’s sessions, releases and starts', async () => {
    const run = scopeRun();

    await run.activate([reader]);

    const info = run.servicesOf('reader').get(SESSION_INFO);

    expect(info.get(run.harness.mainSession.id)?.state).toBe('running');
    expect(info.list().map((session) => session.id)).toEqual([run.harness.mainSession.id]);
    expect(info.isReleased(run.harness.mainSession.id)).toBe(false);
    expect(info.releasedStarts()).toEqual([]);
  });

  it('refuses every method without session:read, naming the extension and the grant', async () => {
    const run = scopeRun();

    await run.activate([blind]);

    const info = run.servicesOf('blind').get(SESSION_INFO);
    const calls = [
      () => info.get(run.harness.mainSession.id),
      () => info.list(),
      () => info.isReleased(run.harness.mainSession.id),
      () => info.releasedStarts(),
      () => info.onLifecycle(() => undefined),
    ];

    for (const call of calls) {
      expect(call).toThrow(ExtensionUndeclaredError);
      expect(call).toThrow(/blind/);
      expect(call).toThrow(/session:read/);
    }
  });

  it('delivers only lifecycle updates as { type, session }, never a message', async () => {
    const run = scopeRun();
    const { sessions, mainSession } = run.harness;

    await run.activate([reader]);

    const heard: unknown[] = [];

    run
      .servicesOf('reader')
      .get(SESSION_INFO)
      .onLifecycle((update) => heard.push(update));

    const child = sessions.startChild({
      parentId: mainSession.id,
      startedByCall: callIdSchema.parse('c1'),
      title: 'child',
    });

    sessions.send({ id: child.id, content: 'secret steering', from: mainSession.id });
    sessions.report({ id: child.id, status: 'working' });
    sessions.setModel({ id: child.id, modelId: modelIdSchema.parse(randomUUID()) });
    sessions.idle({ id: child.id, outcome: 'completed' });
    sessions.resume(child.id);
    sessions.end({ id: child.id, state: 'completed' });
    sessions.release(child.id);

    expect(heard.map((update) => (update as { type: string }).type)).toEqual([
      'session_started',
      'session_idle',
      'session_resumed',
      'session_ended',
      'session_released',
    ]);
    expect(heard.every((update) => Object.keys(update as object).join() === 'type,session')).toBe(
      true,
    );
    expect(JSON.stringify(heard)).not.toContain('secret steering');
  });

  it('stops delivering when the returned function is called', async () => {
    const run = scopeRun();

    await run.activate([reader]);

    const heard: unknown[] = [];
    const stop = run
      .servicesOf('reader')
      .get(SESSION_INFO)
      .onLifecycle((u) => heard.push(u));

    stop();
    startChildOf(run);

    expect(heard).toEqual([]);
  });

  it('exposes no member that writes, publishes or reads content', async () => {
    const run = scopeRun();

    await run.activate([reader]);

    const info = run.servicesOf('reader').get(SESSION_INFO);

    for (const name of [
      'publish',
      'end',
      'idle',
      'resume',
      'release',
      'send',
      'queueNotice',
      'takeNotices',
      'takeMessages',
      'subscribe',
      'subscribeEntries',
      'stream',
      'startChild',
    ]) {
      expect(name in info).toBe(false);
    }
  });

  it('throws deactivated after the host stops the extension, and stops its listeners', async () => {
    const run = scopeRun();
    const { deactivate } = await run.activate([reader]);
    const info = run.servicesOf('reader').get(SESSION_INFO);
    const heard: unknown[] = [];

    info.onLifecycle((update) => heard.push(update));
    await deactivate();

    expect(() => info.list()).toThrow(ScopeDeactivatedError);
    expect(() => info.list()).toThrow(/reader/);

    startChildOf(run);

    expect(heard).toEqual([]);
  });
});
