import { describe, expect, it } from 'vitest';
import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import { runServices } from '@sheavly/host/run-services/run-services.utils';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createWebExtension } from '../web.helper.js';
import type { WebExtensionOptions } from '../web.types.js';

const backend = { name: 'none', search: async () => [] };

/** Activates `agents` and `web` on host services built from a real harness, as an app does. */
async function activate(options: Partial<WebExtensionOptions>) {
  const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
  const host = new ExtensionHost({
    extensions: [
      createAgentsExtension(),
      createWebExtension({ webFetch: {}, webSearch: { backend }, ...options }),
    ],
    services: runServices({ harness }),
  });
  const { contributions } = await host.activate({ signal: new AbortController().signal });
  const web = (tools: readonly { name: string }[]) =>
    tools.map((tool) => tool.name).filter((name) => name.startsWith('web_'));

  return {
    contributed: web(contributions.tools),
    shared: web(host.service(SUB_AGENTS).tools),
  };
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

  it('contributes nothing when both are disabled', async () => {
    const { contributed, shared } = await activate({ webFetch: false, webSearch: false });

    expect(contributed).toEqual([]);
    expect(shared).toEqual([]);
  });
});
