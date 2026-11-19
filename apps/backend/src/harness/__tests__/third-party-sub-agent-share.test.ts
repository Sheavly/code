/**
 * Sharing tools and hooks with sub-agents needs the `sub-agent:share` grant. Every test runs for
 * a built-in and a third-party probe that declare the same manifest, through a real run in which
 * the model starts a real sub-agent, so what the sub-agent's model request carries decides, not
 * who shared. Only package subpaths are imported, like the other third-party tests.
 */
import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import {
  ExtensionGrantError,
  ExtensionUndeclaredError,
} from '@sheavly/extension/errors/manifest.errors';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { fakeTool } from '@sheavly/extension/testing/extension.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { subAgentRun } from '../../testing/prompt-run.fake.js';
import { GRANTS_WITH_SHARE, scopeProbe } from '../../testing/scope-probe.fake.js';
import { ALL_GRANTS, PROBE_KINDS, SHARE_GRANT } from '../../testing/testing.constants.js';

const open = useBackendRuns();
const MARKER = 'SHARED-HOOK-RAN';

/** A hook that adds `MARKER` to the history of every session that runs it. */
const markingHook = defineHook({
  name: 'marking',
  sessionStart: async ({ addContext }) => addContext(MARKER),
});

describe.each(PROBE_KINDS)('$label extension sharing with sub-agents', ({ origin }) => {
  /** A run with probes named `names` that hold `grants` and read `sub-agents`, then the open run. */
  const openSharers = async (grants: string[], names: string[] = ['probe']) => {
    const run = subAgentRun();
    const probes = names.map((name) => scopeProbe({ name, origin, grants, subAgents: true }));
    const harness = await open({
      extensions: probes.map((probe) => probe.extension),
      ...run.options,
    });
    const scopes = probes.map((probe) => {
      const { sharing } = probe.scopes();

      if (!sharing) throw new Error('the probe holds no sub-agents scope');

      return sharing;
    });

    return { run, harness, scopes, probes };
  };

  const toolNames = (request?: { tools: { name: string }[] }) =>
    request?.tools.map((tool) => tool.name) ?? [];

  describe('without sub-agent:share', () => {
    it('refuses share naming the extension and the grant, and nothing reaches the sub-agent', async () => {
      const { run, harness, scopes } = await openSharers(ALL_GRANTS);
      const attempt = () => scopes[0]?.share({ tools: [fakeTool('sneaky')], hooks: [markingHook] });

      expect(attempt).toThrow(ExtensionUndeclaredError);
      expect(attempt).toThrow(
        expect.objectContaining({ extension: 'probe', use: 'grant', undeclared: SHARE_GRANT }),
      );
      expect(attempt).toThrow(/probe/);

      const { main, sub } = await run.start(harness);

      expect(toolNames(sub)).not.toContain('sneaky');
      expect(toolNames(main)).not.toContain('sneaky');
      expect(JSON.stringify(sub?.messages)).not.toContain(MARKER);
    });
  });

  describe('with sub-agent:share', () => {
    it('puts a shared tool in the sub-agent’s request, with the tools it always gets', async () => {
      const { run, harness, scopes } = await openSharers(GRANTS_WITH_SHARE);

      scopes[0]?.share({ tools: [fakeTool('shared_tool')] });

      const { sub } = await run.start(harness);

      expect(toolNames(sub)).toEqual(
        expect.arrayContaining(['shared_tool', 'start_agent', 'report_status']),
      );
    });

    it('runs a shared hook in the sub-agent, and in no other session', async () => {
      const { run, harness, scopes } = await openSharers(GRANTS_WITH_SHARE);

      scopes[0]?.share({ hooks: [markingHook] });

      const { main, sub } = await run.start(harness);

      expect(JSON.stringify(sub?.messages)).toContain(MARKER);
      expect(JSON.stringify(main?.messages)).not.toContain(MARKER);
    });

    it('refuses a second extension that shares a tool name already shared, and keeps the first', async () => {
      const { run, harness, scopes } = await openSharers(GRANTS_WITH_SHARE, ['first', 'second']);

      scopes[0]?.share({ tools: [fakeTool('taken')] });

      expect(() => scopes[1]?.share({ tools: [fakeTool('taken')] })).toThrow(
        /already shared with sub-agents/,
      );

      scopes[1]?.share({ tools: [fakeTool('free')] });

      const { sub } = await run.start(harness);

      expect(toolNames(sub).filter((name) => name === 'taken')).toHaveLength(1);
      expect(toolNames(sub)).toContain('free');
    });

    it('throws the deactivated error from share once the main session has ended', async () => {
      const { harness, scopes } = await openSharers(GRANTS_WITH_SHARE);
      const isDeactivated = () => {
        try {
          // Sharing nothing: while the scope is armed this changes no run.
          scopes[0]?.share({});
        } catch (caughtError) {
          return caughtError instanceof ScopeDeactivatedError;
        }

        return false;
      };

      harness.sessions.end({ id: harness.mainSession.id, state: 'completed' });
      await until(isDeactivated);

      expect(() => scopes[0]?.share({ tools: [fakeTool('late')] })).toThrow(
        /"sub-agents" service of extension "probe"/,
      );
    });
  });

  describe('the manifest', () => {
    it('fails the activation of an extension that lists the grant without requiring sub-agents', async () => {
      const probe = scopeProbe({ name: 'probe', origin, grants: GRANTS_WITH_SHARE });

      const failure = open({ extensions: [probe.extension] });

      await expect(failure).rejects.toBeInstanceOf(ExtensionGrantError);
      await expect(failure).rejects.toThrow(SHARE_GRANT);
    });

    it('fails the activation on a grant that is a typo of sub-agent:share', async () => {
      const probe = scopeProbe({
        name: 'probe',
        origin,
        grants: [...ALL_GRANTS, 'sub-agent:shared'],
        subAgents: true,
      });

      const failure = open({ extensions: [probe.extension] });

      await expect(failure).rejects.toBeInstanceOf(ExtensionGrantError);
      await expect(failure).rejects.toThrow('sub-agent:shared');
    });
  });
});
