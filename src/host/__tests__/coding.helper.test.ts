import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { TrustStore } from '../../runtime/trust/trust.service.js';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createCodingHarness } from '../coding.helper.js';

/** The project: AGENTS.md, and one `.sheavly/` hook that does nothing. */
const FILES = {
  'AGENTS.md': 'AGENTS NOTE\n',
  '.sheavly/hooks.json': JSON.stringify({ version: 1, hooks: [{ path: 'hooks/marker.js' }] }),
  '.sheavly/hooks/marker.js': `export default { name: 'marker', sessionStart: async () => {} };\n`,
};

let base: string;
let root: string;
let trustStore: TrustStore;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'coding-harness-'));
  root = path.join(base, 'project');

  for (const [file, contents] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }

  trustStore = new TrustStore({ file: path.join(base, 'trusted.json') });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const open = (trustWorkspace: boolean, onModelCall?: (request: ProviderRequest) => void) =>
  createCodingHarness({
    provider: routedProvider({ hi: [say('hello')] }),
    title: 'hi',
    workspaceRoot: root,
    trustStore,
    trustWorkspace,
    onModelCall,
  });

describe('createCodingHarness', () => {
  it('opens the workspace and adds the file tools and run_command to the generic ones', async () => {
    const harness = await open(false);

    expect(harness.workspace.root).toBe(realpathSync(root));
    expect(harness.tools.map((tool) => tool.name)).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'run_command',
      'task_status',
      'cancel_task',
      'start_agent',
      'message_agent',
    ]);
  });

  it('loads no .sheavly/ hooks in an untrusted workspace, and says why', async () => {
    const harness = await open(false);

    expect(harness.projectTrust).toBe('untrusted');
    expect(harness.projectHooks).toEqual([]);
    expect(harness.hooks.map((hook) => hook.name)).toEqual(['agents-md']);
  });

  it('runs the AGENTS.md hook first, then a trusted workspace’s .sheavly/ hooks', async () => {
    const requests: ProviderRequest[] = [];
    const harness = await open(true, (request) => requests.push(request));

    expect(harness.projectTrust).toBe('trusted');
    expect(harness.hooks.map((hook) => hook.name)).toEqual(['agents-md', 'marker']);

    await runAgent({
      provider: harness.provider,
      tools: harness.tools,
      hooks: harness.hooks,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(requests[0]?.instructions).toContain('AGENTS NOTE');
  });
});
