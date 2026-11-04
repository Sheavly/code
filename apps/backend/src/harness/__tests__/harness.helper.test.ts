import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { routedProvider, say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { createBackendHarness } from '../harness.helper.js';

/** The project: AGENTS.md, a skill, and one `.sheavly/` hook that does nothing. */
const FILES = {
  'AGENTS.md': 'AGENTS NOTE\n',
  '.agents/skills/review/SKILL.md': '---\nname: review\ndescription: REVIEW SKILL\n---\nSteps\n',
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

const open = (
  trustWorkspace: boolean,
  onModelCall?: (request: ProviderRequest) => void,
  scripts: Record<string, Script[]> = { hi: [say('hello')] },
) =>
  createBackendHarness({
    provider: routedProvider(scripts),
    title: 'hi',
    workspaceRoot: root,
    trustStore,
    env: process.env,
    trustWorkspace,
    onModelCall,
  });

describe('createBackendHarness: what a backend run includes', () => {
  it('opens the workspace with the file tools, run_command, task and sub-agent tools', async () => {
    const harness = await open(false);

    expect(harness.workspace.root).toBe(realpathSync(root));
    expect(harness.tools.map((tool) => tool.name)).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'read_skill',
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
    expect(harness.hooks.map((hook) => hook.name)).toEqual(['agents-md', 'skills']);
  });

  it('runs the AGENTS.md and skills hooks first, then a trusted workspace’s .sheavly/ hooks', async () => {
    const requests: ProviderRequest[] = [];
    const harness = await open(true, (request) => requests.push(request));

    expect(harness.projectTrust).toBe('trusted');
    expect(harness.hooks.map((hook) => hook.name)).toEqual(['agents-md', 'skills', 'marker']);

    await runAgent({
      provider: harness.provider,
      tools: harness.tools,
      hooks: harness.hooks,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(requests[0]?.instructions).toContain('AGENTS NOTE');
    expect(requests[0]?.instructions).toContain('- review: REVIEW SKILL');
  });

  it('gives sub-agents the same skill list and read_skill', async () => {
    const requests: ProviderRequest[] = [];
    const harness = await open(false, (request) => requests.push(request), {
      go: [
        () => [
          toolCall({ id: 'm1', name: 'start_agent', input: { title: 'Helper', task: 'help' } }),
          { type: 'done', stopReason: 'tool_use' },
        ],
        say('done'),
      ],
      help: [say('helped')],
    });
    // The sub-agent is a background task: wait for it, or the prompt can end (and `close` cancel
    // it) before it made its first call, which a busy machine makes likely.
    const conversation = createConversation({
      harness,
      run: streamAgent,
      tools: harness.tools,
      hooks: harness.hooks,
      waitForTasks: true,
    });

    for await (const _event of conversation.send('go'));
    await conversation.close();

    const sub = requests.find((request) => request.messages[0]?.content === 'help');

    expect(sub?.instructions).toContain('- review: REVIEW SKILL');
    expect(sub?.tools.map((tool) => tool.name)).toContain('read_skill');
  });
});
