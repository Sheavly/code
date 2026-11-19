import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { APPROVALS } from '@sheavly/extension/run-services/run-services.utils';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { approveAll } from '../../testing/approve-all.fake.js';
import { scopeRun } from '../../testing/scope-run.fake.js';
import { MAX_CONCERN_TEXT_CHARS, MAX_REQUEST_CONCERNS } from '../run-services.constants.js';

const asker = { name: 'asker', requires: [APPROVALS.name], grants: ['approval:request'] };
const blind = { name: 'blind', requires: [APPROVALS.name], grants: [] };
const request = () => ({
  callId: callIdSchema.parse('c1'),
  command: 'ls',
  concerns: [],
  signal: new AbortController().signal,
});

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

  it('builds the default request: attributed to the extension, answered once, keeping nothing', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);
    await run.servicesOf('asker').get(APPROVALS).request(request());

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ tool: 'extension:asker', command: '[asker] ls' });
    expect(heard[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
    expect(heard[0] && 'keeps' in heard[0]).toBe(false);
  });

  it('refuses tool, options and keeps without their grant, naming it, and asks nobody', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([{ ...asker, tools: ['run_command'] }]);

    const scope = run.servicesOf('asker').get(APPROVALS);
    const asTool = Object.assign(request(), { tool: 'run_command' });
    const withOptions = Object.assign(request(), { options: ['approve', 'skip'] as const });
    const withKeeps = Object.assign(request(), { keeps: ['git log *'] });

    await expect(scope.request(asTool)).rejects.toThrow(ExtensionUndeclaredError);
    await expect(scope.request(asTool)).rejects.toThrow(/asker.*approval:as-tool/s);
    await expect(scope.request(withOptions)).rejects.toThrow(/approval:keep/);
    await expect(scope.request(withKeeps)).rejects.toThrow(ExtensionUndeclaredError);
    expect(heard).toEqual([]);
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

  it('drops a concern without two string fields', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);
    await run
      .servicesOf('asker')
      .get(APPROVALS)
      .request(
        Object.assign(request(), {
          concerns: [{ argument: 'only argument' }, { argument: 1, reason: 2 }, null, 'text'],
        }),
      );

    // No `undefined` or `1` turned into text: an entry without two strings is not a concern.
    expect(heard[0]?.concerns).toEqual([]);
  });

  it('ends a text over the cap with an ellipsis counted inside the cap, and leaves others whole', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);

    const scope = run.servicesOf('asker').get(APPROVALS);
    const long = 'x'.repeat(MAX_CONCERN_TEXT_CHARS + 50);
    const exact = 'y'.repeat(MAX_CONCERN_TEXT_CHARS);

    await scope.request(
      Object.assign(request(), {
        concerns: [
          { argument: long, reason: long },
          { argument: exact, reason: 'short' },
        ],
      }),
    );

    const [cut, whole] = heard[0]?.concerns ?? [];

    expect(cut?.argument).toBe(`${'x'.repeat(MAX_CONCERN_TEXT_CHARS - 1)}…`);
    expect(cut?.reason).toHaveLength(MAX_CONCERN_TEXT_CHARS);
    expect(whole).toEqual({ argument: exact, reason: 'short' });
  });

  it('never cuts between the two halves of a character before the ellipsis', async () => {
    const run = scopeRun();
    const heard = approveAll(run);

    await run.activate([asker]);

    // The emoji's first half is the last unit that would be kept, so it is dropped with its pair.
    const text = `${'a'.repeat(MAX_CONCERN_TEXT_CHARS - 2)}😀zz`;

    await run
      .servicesOf('asker')
      .get(APPROVALS)
      .request(Object.assign(request(), { concerns: [{ argument: text, reason: 'r' }] }));

    expect(heard[0]?.concerns[0]?.argument).toBe(`${'a'.repeat(MAX_CONCERN_TEXT_CHARS - 2)}…`);
  });

  /** What the UI hears when the asker passes `count` numbered concerns. */
  async function heardWith(count: number) {
    const run = scopeRun();
    const heard = approveAll(run);
    const concerns = Array.from({ length: count }, (_unused, index) => ({
      argument: `a${String(index)}`,
      reason: 'r',
    }));

    await run.activate([asker]);
    await run
      .servicesOf('asker')
      .get(APPROVALS)
      .request({ ...request(), concerns });

    return { concerns, shown: heard[0]?.concerns ?? [] };
  }

  it('passes exactly the cap through unchanged', async () => {
    const { concerns, shown } = await heardWith(MAX_REQUEST_CONCERNS);

    expect(shown).toEqual(concerns);
  });

  it('over the cap keeps the first cap-1 and adds one concern counting what is not shown', async () => {
    const total = MAX_REQUEST_CONCERNS + 5;
    const { concerns, shown } = await heardWith(total);

    expect(shown).toHaveLength(MAX_REQUEST_CONCERNS);
    expect(shown.slice(0, -1)).toEqual(concerns.slice(0, MAX_REQUEST_CONCERNS - 1));
    expect(shown.at(-1)).toEqual({
      argument: `+${String(total - (MAX_REQUEST_CONCERNS - 1))} more`,
      reason: `not shown here: the request had ${String(total)} concerns`,
    });
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
