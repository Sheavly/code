/**
 * A tool name is attributable (`approval:as-tool`) only once the merge that checks collisions has
 * passed. Every test runs for a built-in and a third-party probe with the same manifest, through
 * a real backend run, so the window is closed by the shape of the service, not by who asks.
 * Nothing can subscribe to the approvals of a run that is still activating, so a request that
 * wrongly got through would fail with the registry's no-listener refusal: the tests pin that the
 * refusal is the attribution one, raised before the registry is asked.
 */
import { describe, expect, it } from 'vitest';
import { ContributionCollisionError } from '@sheavly/extension/errors/extension.errors';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { ApprovalToolNotContributedError } from '@sheavly/host/errors/scopes.errors';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { listenAndAnswer } from '../../testing/approval-ui.fake.js';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { scopeProbe } from '../../testing/scope-probe.fake.js';
import { PROBE_KINDS } from '../../testing/testing.constants.js';

const open = useBackendRuns();

/** What a probe's request as `tool` came to: the error that refused it, or its answer. */
const askAs = (probe: ReturnType<typeof scopeProbe>, tool: string) =>
  probe
    .scopes()
    .approvals.request({
      callId: callIdSchema.parse('ask'),
      command: 'rm -rf /',
      concerns: [],
      signal: new AbortController().signal,
      tool,
    })
    .catch((caughtError: unknown) => caughtError);

describe.each(PROBE_KINDS)(
  '$label extension asking as its tool during activation',
  ({ origin }) => {
    describe('when two extensions contribute the same tool name', () => {
      it('fails the activation, and neither is ever attributed that tool', async () => {
        const duringActivation: Promise<unknown>[] = [];
        const first = scopeProbe({ name: 'first', origin, tools: ['shared_tool'] });
        const second = scopeProbe({
          name: 'second',
          origin,
          tools: ['shared_tool'],
          onActivate: () => duringActivation.push(askAs(first, 'shared_tool')),
        });

        await expect(open({ extensions: [first.extension, second.extension] })).rejects.toThrow(
          ContributionCollisionError,
        );

        const afterwards = await Promise.all([
          askAs(first, 'shared_tool'),
          askAs(second, 'shared_tool'),
        ]);

        // While the colliding extensions activate, the name is attributable to neither.
        expect(duringActivation).toHaveLength(1);
        await expect(duringActivation[0]).resolves.toBeInstanceOf(ApprovalToolNotContributedError);

        // The failed run stopped them: nothing they hold asks anyone anything.
        for (const outcome of afterwards) {
          expect(outcome).toBeInstanceOf(ScopeDeactivatedError);
        }
      });
    });

    describe('when the names are unique', () => {
      it('refuses the earlier extension while a later one activates, and allows it once the run started', async () => {
        const duringActivation: Promise<unknown>[] = [];
        const first = scopeProbe({ name: 'first', origin, tools: ['first_tool'] });
        const second = scopeProbe({
          name: 'second',
          origin,
          tools: ['second_tool'],
          onActivate: () => duringActivation.push(askAs(first, 'first_tool')),
        });
        const harness = await open({ extensions: [first.extension, second.extension] });
        const heard = listenAndAnswer(harness);

        expect(duringActivation).toHaveLength(1);
        await expect(duringActivation[0]).resolves.toBeInstanceOf(ApprovalToolNotContributedError);
        expect(heard).toEqual([]);

        await askAs(first, 'first_tool');
        await askAs(second, 'second_tool');

        expect(heard.map((request) => request.tool)).toEqual(['first_tool', 'second_tool']);
        expect(heard.every((request) => request.command === 'rm -rf /')).toBe(true);
      });

      it('does not let the earlier extension ask as the later one’s tool once the run started', async () => {
        const first = scopeProbe({ name: 'first', origin, tools: ['first_tool'] });
        const second = scopeProbe({ name: 'second', origin, tools: ['second_tool'] });
        const harness = await open({ extensions: [first.extension, second.extension] });
        const heard = listenAndAnswer(harness);

        expect(await askAs(first, 'second_tool')).toBeInstanceOf(ApprovalToolNotContributedError);
        expect(heard).toEqual([]);
      });
    });
  },
);
