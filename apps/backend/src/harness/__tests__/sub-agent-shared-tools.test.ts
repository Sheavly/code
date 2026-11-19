/**
 * The real `coding` and `web` extensions still share their tools with a sub-agent now that
 * sharing needs the `sub-agent:share` grant: this fails if either stops declaring it. A real run,
 * a real sub-agent, and what its model request carries.
 */
import { describe, expect, it } from 'vitest';
import type { SearchBackend } from '@sheavly/tools/web-search/web-search.types';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { subAgentRun } from '../../testing/prompt-run.fake.js';

const open = useBackendRuns();
const backend: SearchBackend = { name: 'custom', search: async () => [] };

/** The names of the tools the main session's and the sub-agent's model requests carried. */
async function toolsOf(web: { enabled: boolean }) {
  const run = subAgentRun();
  const harness = await open({
    extensions: [],
    ...run.options,
    ...(web.enabled && { webFetch: {}, webSearch: { backend } }),
  });
  const { main, sub } = await run.start(harness);
  const names = (request?: { tools: { name: string }[] }) =>
    request?.tools.map((tool) => tool.name) ?? [];

  return { main: names(main), sub: names(sub) };
}

describe('a sub-agent of the real extensions', () => {
  it('gets the file tools and run_command that coding shares, as the main session does', async () => {
    const { main, sub } = await toolsOf({ enabled: false });
    const shared = ['read_file', 'edit_file', 'run_command', 'glob', 'grep'];

    expect(main).toEqual(expect.arrayContaining(shared));
    expect(sub).toEqual(expect.arrayContaining(shared));
  });

  it('gets web_fetch and web_search that web shares when they are enabled', async () => {
    const { main, sub } = await toolsOf({ enabled: true });

    expect(main).toEqual(expect.arrayContaining(['web_fetch', 'web_search']));
    expect(sub).toEqual(expect.arrayContaining(['web_fetch', 'web_search']));
  });

  it('gets no web tools when they are off, and still the tools agents gives every sub-agent', async () => {
    const { sub } = await toolsOf({ enabled: false });

    expect(sub).not.toContain('web_fetch');
    expect(sub).not.toContain('web_search');
    expect(sub).toEqual(expect.arrayContaining(['start_agent', 'report_status']));
  });
});
