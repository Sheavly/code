import { describe, expect, it } from 'vitest';
import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';
import type { Extension } from '@sheavly/extension/extension/extension.types';
import { requireGrant } from '@sheavly/extension/extension/grants.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { fakeExtension } from '@sheavly/extension/testing/extension.fake';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.helper';
import { noSubAgentRuns } from '@sheavly/host/testing/run-loop.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createWebExtension } from '../web.helper.js';
import type { WebExtensionOptions } from '../web.types.js';

const backend = { name: 'none', search: async () => [] };

/**
 * Activates `web` on host services built from a real harness, with a stand-in for `agents` whose
 * write-only `sub-agents` service records what is shared (the real one keeps it private).
 */
async function activate(
  options: Partial<WebExtensionOptions>,
  adjust: (web: Extension) => Extension = (web) => web,
) {
  const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
  const sharedTools: { name: string }[] = [];
  const agents = fakeExtension({
    name: 'agents',
    provides: [SUB_AGENTS.name],
    serviceGrants: { [SUB_AGENTS.name]: ['sub-agent:share'] },
    activate: ({ services }) => {
      services.provideFor({
        key: SUB_AGENTS,
        create: (consumer) => ({
          value: {
            share: ({ tools = [] }) => {
              requireGrant({
                extension: consumer.name,
                grants: consumer.manifest.grants ?? [],
                grant: 'sub-agent:share',
              });
              sharedTools.push(...tools);
            },
          },
        }),
      });

      return {};
    },
  });
  const web = adjust(createWebExtension({ webFetch: {}, webSearch: { backend }, ...options }));
  const host = new ExtensionHost({
    extensions: [agents, web],
    services: runServices({ harness, runSession: noSubAgentRuns }),
  });
  const { contributions, failed } = await host.activate({ signal: new AbortController().signal });
  const webOnly = (tools: readonly { name: string }[]) =>
    tools.map((tool) => tool.name).filter((name) => name.startsWith('web_'));

  return { contributed: webOnly(contributions.tools), shared: webOnly(sharedTools), failed };
}

describe('the web extension', () => {
  it('contributes web_fetch and web_search and shares them with sub-agents', async () => {
    const { contributed, shared } = await activate({});

    expect(contributed).toEqual(['web_fetch', 'web_search']);
    expect(shared).toEqual(['web_fetch', 'web_search']);
  });

  it('declares in its manifest exactly the tools it contributes with both enabled', async () => {
    const { contributed } = await activate({});

    expect(contributed).toEqual(
      readManifest(new URL('../../../sheavly.json', import.meta.url)).tools,
    );
  });

  it('leaves out a tool that is disabled, for the main run and sub-agents alike', async () => {
    const { contributed, shared } = await activate({ webSearch: false });

    expect(contributed).toEqual(['web_fetch']);
    expect(shared).toEqual(['web_fetch']);
  });

  it('declares the grant it needs to share, and fails to activate without it', async () => {
    const { failed } = await activate({}, (web) => ({
      ...web,
      manifest: { ...web.manifest, grants: [] },
    }));

    expect(readManifest(new URL('../../../sheavly.json', import.meta.url)).grants).toEqual([
      'sub-agent:share',
    ]);
    expect(failed.map((one) => one.extension)).toEqual(['web']);
    expect(failed[0]?.cause).toMatchObject({
      name: 'ExtensionUndeclaredError',
      use: 'grant',
      undeclared: 'sub-agent:share',
    });
  });

  it('contributes nothing when both are disabled', async () => {
    const { contributed, shared } = await activate({ webFetch: false, webSearch: false });

    expect(contributed).toEqual([]);
    expect(shared).toEqual([]);
  });
});
