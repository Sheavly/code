/**
 * What a scoped service hands out or shares is frozen copies, never the run's live objects, and
 * the calls that act on a child or the user check the run's state. Every test runs for a built-in
 * and a third-party probe with the same manifest, so the shape of the service decides, not who
 * asks. Only package subpaths are imported, like the other third-party tests.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { ChildRunningError } from '@sheavly/host/errors/scopes.errors';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import { callIdSchema, messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { manifestOf } from '../../testing/manifest.fake.js';
import { scopeProbe } from '../../testing/scope-probe.fake.js';
import { PROBE_KINDS } from '../../testing/testing.constants.js';

const open = useBackendRuns();
const call = (id: string) => callIdSchema.parse(id);

/** The parts of a nested run a test does not care about, with a prompt of `content`. */
const runOf = (content: string) => ({
  provider: routedProvider({ go: [say('done')] }),
  tools: [],
  hooks: [],
  instructions: 'be brief',
  messages: [{ role: 'user' as const, id: messageIdSchema.parse(randomUUID()), content, at: 1 }],
  signal: new AbortController().signal,
});

describe.each(PROBE_KINDS)('$label extension with every grant', ({ origin }) => {
  const openProbe = async () => {
    const probe = scopeProbe({ name: 'probe', origin });
    const harness = await open({ extensions: [probe.extension] });

    return { probe, harness, main: harness.mainSession };
  };

  it('returns a child ref that cannot be changed to name another session', async () => {
    const { probe, main } = await openProbe();
    const { child } = probe.scopes();
    const started = child.startChild({ parentId: main.id, startedByCall: call('c1'), title: 't' });
    const forged = started as { id: string };

    expect(Object.isFrozen(started)).toBe(true);
    expect(() => {
      forged.id = main.id;
    }).toThrow(TypeError);
    expect(started.id).not.toBe(main.id);
  });

  it('refuses a run whose child names a session it did not start, and the main session keeps running', async () => {
    const { probe, harness, main } = await openProbe();
    const { child } = probe.scopes();
    const started = child.startChild({ parentId: main.id, startedByCall: call('c1'), title: 't' });
    const task = probe.startWaiting(main.id);

    await expect(
      child.runChild({ ...runOf('go'), child: { ...started, id: main.id } }),
    ).rejects.toThrow(SessionError);
    expect(harness.sessions.get(main.id)?.state).toBe('running');
    expect(harness.tasks.get(task.id)?.status).toBe('running');
    await probe.scopes().tasks.cancel(task.id);
  });

  it('refuses a run for a child that has ended', async () => {
    const { probe, harness, main } = await openProbe();
    const { child } = probe.scopes();
    const started = child.startChild({ parentId: main.id, startedByCall: call('c1'), title: 't' });

    harness.sessions.end({ id: started.id, state: 'completed' });

    await expect(child.runChild({ ...runOf('go'), child: started })).rejects.toThrow(/has ended/);
  });

  it('refuses a second run on a child that is already running', async () => {
    const { probe, main } = await openProbe();
    const { child } = probe.scopes();
    const started = child.startChild({ parentId: main.id, startedByCall: call('c1'), title: 't' });
    const first = child.runChild({ ...runOf('go'), child: started });

    await expect(child.runChild({ ...runOf('go'), child: started })).rejects.toThrow(
      ChildRunningError,
    );
    await expect(first).resolves.toMatchObject({ reason: 'completed' });
  });

  it('shares the main session as a frozen copy: assigning to it changes nothing in the run', async () => {
    const { probe, harness } = await openProbe();
    const shared = probe.scopes().main as { id: string };
    const before = harness.mainSession.id;

    expect(shared).toEqual(harness.mainSession);
    expect(shared).not.toBe(harness.mainSession);
    expect(Object.isFrozen(shared)).toBe(true);
    expect(() => {
      shared.id = 'hijacked';
    }).toThrow(TypeError);
    expect(harness.mainSession.id).toBe(before);
  });

  it('asks the user as the extension, once: no permanent or session rule, whatever it passes', async () => {
    const { probe, harness, main } = await openProbe();
    const heard: ApprovalRequest[] = [];

    harness.approvals.subscribe((update) => {
      if (update.type !== 'approval_requested') return;

      heard.push(update.request);
      harness.approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
    });

    // A caller that ignores the type, as plain JavaScript can, passes `keeps` and wider options.
    const forged = {
      callId: call('ask'),
      sessionId: main.id,
      command: 'rm -rf /',
      concerns: [],
      signal: new AbortController().signal,
      tool: 'run_command',
      options: ['approve', 'always_allow', 'allow_session'],
      keeps: [['rm']],
    };

    await probe.scopes().approvals.request(forged);

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ tool: 'extension:probe', command: '[probe] rm -rf /' });
    expect(heard[0]?.options).not.toContain('always_allow');
    expect(heard[0]?.options).not.toContain('allow_session');
    expect(heard[0] && 'keeps' in heard[0]).toBe(false);
  });

  it('holds a write-only sub-agents service: it can share, never read or change what is shared', async () => {
    const held: unknown[] = [];
    const reader = defineExtension({
      origin,
      manifest: manifestOf({
        name: 'reader',
        dependsOn: ['agents'],
        services: { requires: [SUB_AGENTS.name] },
      }),
      activate: ({ services }) => {
        held.push(services.get(SUB_AGENTS));

        return {};
      },
    });

    await open({ extensions: [reader] });

    const service = held[0] as object;
    const readable = ['tools', 'taskTools', 'hooks'].filter((name) => name in service);

    expect(Reflect.ownKeys(service)).toEqual(['share']);
    expect(readable).toEqual([]);
    expect(Object.isFrozen(service)).toBe(true);
    expect(() => Object.assign(service, { hooks: [] })).toThrow(TypeError);
  });
});
