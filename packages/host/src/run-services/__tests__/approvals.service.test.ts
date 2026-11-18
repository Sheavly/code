import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { ScopeDeactivatedError } from '../../errors/scopes.errors.js';
import { scopeRun } from '../../testing/scope-run.fake.js';
import { MAX_CONCERN_TEXT_CHARS, MAX_REQUEST_CONCERNS } from '../run-services.constants.js';
import { APPROVALS } from '../run-services.utils.js';

const asker = { name: 'asker', requires: [APPROVALS.name], grants: ['approval:request'] };
const blind = { name: 'blind', requires: [APPROVALS.name], grants: [] };
const request = () => ({
  callId: callIdSchema.parse('c1'),
  command: 'ls',
  concerns: [],
  signal: new AbortController().signal,
});

/** A UI that approves every request it hears, and the requests it heard. */
function approveAll(run: ReturnType<typeof scopeRun>) {
  const heard: ApprovalRequest[] = [];

  run.harness.approvals.subscribe((update) => {
    if (update.type !== 'approval_requested') return;

    heard.push(update.request);
    run.harness.approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
  });

  return heard;
}

describe('the approvals service', () => {
  it('requests through the real registry, which a UI then answers', async () => {
    const run = scopeRun();
    const { approvals } = run.harness;

    // The UI's side: it answers whatever the extension's request announces.
    approvals.subscribe((update) => {
      if (update.type !== 'approval_requested') return;

      approvals.respond({ id: update.request.id, response: { decision: 'approve' } });
    });
    await run.activate([asker]);

    await expect(run.servicesOf('asker').get(APPROVALS).request(request())).resolves.toEqual({
      decision: 'approve',
    });
  });

  it('builds the request: attributed to the extension, answered once, keeping nothing', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);

    // A caller that ignores the type (plain JavaScript) still cannot ask for a permanent rule.
    const forged = {
      ...request(),
      tool: 'run_command',
      options: ['approve', 'always_allow', 'allow_session'],
      keeps: [['git', 'log']],
    };

    await run.servicesOf('asker').get(APPROVALS).request(forged);

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ tool: 'extension:asker', command: '[asker] ls' });
    expect(heard[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
    expect(heard[0] && 'keeps' in heard[0]).toBe(false);
  });

  it('rebuilds concerns as two strings each, and reads a missing or non-array one as none', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);

    const scope = run.servicesOf('asker').get(APPROVALS);
    // Plain JavaScript can pass anything: assign over the typed field rather than spread, which would retype it.
    const junk = (concerns: unknown) => Object.assign(request(), { concerns });

    await scope.request(junk([{ argument: 'a', reason: 'r', extra: 1 }]));
    await scope.request(junk(undefined));
    await scope.request(junk('not a list'));

    expect(heard.map((heardRequest) => heardRequest.concerns)).toEqual([
      [{ argument: 'a', reason: 'r' }],
      [],
      [],
    ]);
  });

  it('drops a concern without two string fields, and bounds how many and how long the rest are', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);

    const scope = run.servicesOf('asker').get(APPROVALS);
    const long = 'x'.repeat(MAX_CONCERN_TEXT_CHARS + 50);
    const many = Array.from({ length: MAX_REQUEST_CONCERNS + 5 }, (_unused, index) => ({
      argument: `a${String(index)}`,
      reason: 'r',
    }));

    await scope.request(
      Object.assign(request(), {
        concerns: [{ argument: 'only argument' }, { argument: 1, reason: 2 }, null, 'text'],
      }),
    );
    await scope.request(Object.assign(request(), { concerns: [{ argument: long, reason: long }] }));
    await scope.request(Object.assign(request(), { concerns: many }));

    const [unusable, cut, capped] = heard.map((heardRequest) => heardRequest.concerns);

    // No `undefined` or `1` turned into text: an entry without two strings is not a concern.
    expect(unusable).toEqual([]);
    expect(cut?.[0]?.argument).toHaveLength(MAX_CONCERN_TEXT_CHARS);
    expect(cut?.[0]?.reason).toHaveLength(MAX_CONCERN_TEXT_CHARS);
    expect(capped).toHaveLength(MAX_REQUEST_CONCERNS);
    expect(capped?.[0]?.argument).toBe('a0');
  });

  it('refuses a request for a session that is not open in the run', async () => {
    const run = scopeRun();

    await run.activate([asker]);

    const scope = run.servicesOf('asker').get(APPROVALS);
    const nowhere = sessionIdSchema.parse('nowhere');
    const main = run.harness.mainSession.id;

    await expect(scope.request({ ...request(), sessionId: nowhere })).rejects.toThrow(
      /Unknown session/,
    );
    run.harness.approvals.subscribe((update) => {
      if (update.type !== 'approval_requested') return;

      run.harness.approvals.respond({ id: update.request.id, response: { decision: 'skip' } });
    });
    await expect(scope.request({ ...request(), sessionId: main })).resolves.toEqual({
      decision: 'skip',
    });
  });

  it('reads whether a UI is listening, and is refused at once when none is', async () => {
    const run = scopeRun();

    await run.activate([asker]);

    const scope = run.servicesOf('asker').get(APPROVALS);

    expect(scope.listening).toBe(false);
    await expect(scope.request(request())).rejects.toThrow(/No one is listening/);

    const stop = run.harness.approvals.subscribe(() => undefined);

    expect(scope.listening).toBe(true);
    stop();
  });

  it('is request-only: no respond, subscribe, observe, pending or screen, and frozen', async () => {
    const run = scopeRun();

    await run.activate([asker]);

    const scope = run.servicesOf('asker').get(APPROVALS);

    expect(scope).not.toBe(run.harness.approvals);
    expect(Object.keys(scope)).toEqual(['request']);
    expect(Object.isFrozen(scope)).toBe(true);

    for (const name of ['respond', 'subscribe', 'observe', 'pending', 'screen', 'registry']) {
      expect(name in scope).toBe(false);
    }
  });

  it('refuses request and listening without approval:request, naming the extension and the grant', async () => {
    const run = scopeRun();

    await run.activate([blind]);

    const scope = run.servicesOf('blind').get(APPROVALS);

    await expect(scope.request(request())).rejects.toThrow(ExtensionUndeclaredError);
    await expect(scope.request(request())).rejects.toThrow(/blind.*approval:request/s);
    expect(() => scope.listening).toThrow(/approval:request/);
  });

  it('throws deactivated after the host stops the extension', async () => {
    const run = scopeRun();
    const { deactivate } = await run.activate([asker]);
    const scope = run.servicesOf('asker').get(APPROVALS);

    await deactivate();

    await expect(scope.request(request())).rejects.toThrow(ScopeDeactivatedError);
    expect(() => scope.listening).toThrow(ScopeDeactivatedError);
  });
});
