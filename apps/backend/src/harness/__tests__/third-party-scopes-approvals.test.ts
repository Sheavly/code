/**
 * What the two grants that widen an approval request do, and what a request gets without them.
 * Every test runs for a built-in and a third-party probe with the same manifest, so the grants
 * decide, not who asks. The all-grants behaviour is pinned in third-party-scopes-frozen.test.ts.
 * Only package subpaths are imported, like the other third-party tests.
 */
import { describe, expect, it } from 'vitest';
import {
  ApprovalToolNotContributedError,
  ScopeArgumentError,
} from '@sheavly/host/errors/scopes.errors';
import type { ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import {
  listenAndAnswer,
  GRANTS_WITHOUT_APPROVAL_WIDENING,
} from '../../testing/approval-ui.fake.js';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { scopeProbe } from '../../testing/scope-probe.fake.js';
import { ALL_GRANTS, PROBE_KINDS } from '../../testing/testing.constants.js';

const open = useBackendRuns();
const TOOL = 'probe_tool';
const ALWAYS_ALLOW: ApprovalResponse = { decision: 'always_allow' };
const WITHOUT_KEEP = ALL_GRANTS.filter((grant) => grant !== 'approval:keep');
const WITHOUT_AS_TOOL = ALL_GRANTS.filter((grant) => grant !== 'approval:as-tool');

const undeclared = (grant: string) => ({
  name: 'ExtensionUndeclaredError',
  extension: 'probe',
  use: 'grant',
  undeclared: grant,
});

describe.each(PROBE_KINDS)('$label extension asking for approval', ({ origin }) => {
  /** A run with a probe that contributes `TOOL` and holds `grants`, and a UI that answers `answer`. */
  const openProbe = async (grants: string[], answer?: ApprovalResponse) => {
    const probe = scopeProbe({ name: 'probe', origin, grants, tools: [TOOL] });
    const harness = await open({ extensions: [probe.extension] });
    const heard = listenAndAnswer(harness, answer);
    const asking = {
      callId: callIdSchema.parse('ask'),
      sessionId: harness.mainSession.id,
      command: 'sleep 5 && echo hi',
      concerns: [],
      signal: new AbortController().signal,
    };

    return { request: probe.scopes().approvals.request, asking, heard };
  };

  describe('without approval:as-tool and approval:keep', () => {
    it('refuses a request that names a tool, naming approval:as-tool, and nothing reaches the UI', async () => {
      const { request, asking, heard } = await openProbe(GRANTS_WITHOUT_APPROVAL_WIDENING);

      await expect(request({ ...asking, tool: TOOL })).rejects.toMatchObject(
        undeclared('approval:as-tool'),
      );
      expect(heard).toEqual([]);
    });

    it('refuses a request that sets options, naming approval:keep, and nothing reaches the UI', async () => {
      const { request, asking, heard } = await openProbe(GRANTS_WITHOUT_APPROVAL_WIDENING);

      await expect(request({ ...asking, options: ['approve', 'skip'] })).rejects.toMatchObject(
        undeclared('approval:keep'),
      );
      expect(heard).toEqual([]);
    });

    it('refuses a request that carries keeps, naming approval:keep, and nothing reaches the UI', async () => {
      const { request, asking, heard } = await openProbe(GRANTS_WITHOUT_APPROVAL_WIDENING);

      await expect(request({ ...asking, keeps: ['sleep *'] })).rejects.toMatchObject(
        undeclared('approval:keep'),
      );
      expect(heard).toEqual([]);
    });

    it('attributes a plain request to the extension with the name prefix, the default options and no keeps', async () => {
      const { request, asking, heard } = await openProbe(GRANTS_WITHOUT_APPROVAL_WIDENING);

      await request(asking);

      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({
        tool: 'extension:probe',
        command: '[probe] sleep 5 && echo hi',
      });
      expect(heard[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
      expect(heard[0] && 'keeps' in heard[0]).toBe(false);
    });
  });

  describe('with approval:as-tool', () => {
    it('asks as a tool the extension contributes, with the command unprefixed', async () => {
      const { request, asking, heard } = await openProbe(WITHOUT_KEEP);

      await request({ ...asking, tool: TOOL });

      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ tool: TOOL, command: 'sleep 5 && echo hi' });
    });

    it.each(['run_command', 'PROBE_TOOL', `${TOOL}_2`, TOOL.slice(0, -1)])(
      'refuses the tool %s the extension does not contribute, matching names exactly',
      async (tool) => {
        const { request, asking, heard } = await openProbe(WITHOUT_KEEP);

        await expect(request({ ...asking, tool })).rejects.toBeInstanceOf(
          ApprovalToolNotContributedError,
        );
        expect(heard).toEqual([]);
      },
    );

    /** Probes named `names` that declare `run_command` without contributing it, each asking as it. */
    const askAsUncontributed = async (names: string[]) => {
      const probes = names.map((name) =>
        scopeProbe({ name, origin, grants: WITHOUT_KEEP, declaredTools: ['run_command'] }),
      );
      const harness = await open({ extensions: probes.map((probe) => probe.extension) });
      const heard = listenAndAnswer(harness);
      const attempts = probes.map((probe) =>
        probe.scopes().approvals.request({
          callId: callIdSchema.parse('ask'),
          sessionId: harness.mainSession.id,
          command: 'rm -rf /',
          concerns: [],
          signal: new AbortController().signal,
          tool: 'run_command',
        }),
      );

      return { attempts, heard };
    };

    it('refuses a tool the manifest declares but the extension does not contribute', async () => {
      const { attempts, heard } = await askAsUncontributed(['probe']);

      await expect(attempts[0]).rejects.toBeInstanceOf(ApprovalToolNotContributedError);
      expect(heard).toEqual([]);
    });

    it('refuses both of two extensions that declare the same unused tool name', async () => {
      const { attempts, heard } = await askAsUncontributed(['probe', 'probe-two']);

      const settled = await Promise.allSettled(attempts);

      for (const outcome of settled) {
        expect(outcome).toMatchObject({ status: 'rejected' });
        expect(outcome.status === 'rejected' && outcome.reason).toBeInstanceOf(
          ApprovalToolNotContributedError,
        );
      }

      expect(heard).toEqual([]);
    });

    it('still refuses options and keeps, because approval:keep is not held', async () => {
      const { request, asking, heard } = await openProbe(WITHOUT_KEEP);

      await expect(request({ ...asking, tool: TOOL, keeps: ['sleep *'] })).rejects.toMatchObject(
        undeclared('approval:keep'),
      );
      expect(heard).toEqual([]);
    });
  });

  describe('with approval:keep', () => {
    it('offers the options asked for and the keeps, and keeps the name prefix', async () => {
      const { request, asking, heard } = await openProbe(WITHOUT_AS_TOOL);

      await request({
        ...asking,
        options: ['approve', 'allow_session', 'always_allow', 'skip'],
        keeps: ['sleep *'],
      });

      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({
        tool: 'extension:probe',
        command: '[probe] sleep 5 && echo hi',
        options: ['approve', 'allow_session', 'always_allow', 'skip'],
        keeps: ['sleep *'],
      });
    });

    it('refuses always_allow offered without keeps, and nothing reaches the UI', async () => {
      const { request, asking, heard } = await openProbe(WITHOUT_AS_TOOL);

      await expect(
        request({ ...asking, options: ['approve', 'always_allow'] }),
      ).rejects.toBeInstanceOf(ScopeArgumentError);
      expect(heard).toEqual([]);
    });

    it('still refuses a tool, because approval:as-tool is not held', async () => {
      const { request, asking, heard } = await openProbe(WITHOUT_AS_TOOL);

      await expect(request({ ...asking, tool: TOOL })).rejects.toMatchObject(
        undeclared('approval:as-tool'),
      );
      expect(heard).toEqual([]);
    });

    it('gives the caller the answer the UI gave', async () => {
      const { request, asking } = await openProbe(WITHOUT_AS_TOOL, ALWAYS_ALLOW);

      const response = await request({
        ...asking,
        options: ['approve', 'always_allow', 'skip'],
        keeps: ['sleep *'],
      });

      expect(response).toMatchObject({ decision: 'always_allow' });
    });
  });

  describe('with both grants', () => {
    it('asks as the contributed tool with its options and keeps, and returns the UI answer', async () => {
      const { request, asking, heard } = await openProbe(ALL_GRANTS, ALWAYS_ALLOW);

      const response = await request({
        ...asking,
        tool: TOOL,
        options: ['approve', 'always_allow', 'skip'],
        keeps: ['sleep *'],
      });

      expect(heard[0]).toMatchObject({
        tool: TOOL,
        command: 'sleep 5 && echo hi',
        options: ['approve', 'always_allow', 'skip'],
        keeps: ['sleep *'],
      });
      expect(response).toMatchObject({ decision: 'always_allow' });
    });
  });
});
