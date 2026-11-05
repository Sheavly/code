import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { memoryTrust } from '@sheavly/workspace/testing/trust.fake';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { routedProvider, say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { createBackendHarness } from '../harness.helper.js';
import { askingPermissions } from '../../testing/permissions.fake.js';

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

  trustStore = new TrustStore({
    persistence: memoryTrust({ file: path.join(base, 'trusted.json') }),
  });
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
    permissions: askingPermissions(),
  });

/** A script step: the model starts the sub-agent whose script is `help`. */
const startHelper: Script = () => [
  toolCall({ id: 'm1', name: 'start_agent', input: { title: 'Helper', task: 'help' } }),
  { type: 'done', stopReason: 'tool_use' },
];

/**
 * Opens a harness on the scripts, sends the prompt `go` and runs it to its end, waiting for the
 * background sub-agents it starts (or the prompt can end, and `close` cancel them, before they
 * made their first call, which a busy machine makes likely). Returns every request the model got.
 */
async function runPrompt(scripts: Record<string, Script[]>): Promise<ProviderRequest[]> {
  const requests: ProviderRequest[] = [];
  const harness = await open(false, (request) => requests.push(request), scripts);
  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: harness.tools,
    hooks: harness.hooks,
    waitForTasks: true,
  });

  for await (const _event of conversation.send('go'));
  await conversation.close();

  return requests;
}

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
    const requests = await runPrompt({
      go: [startHelper, say('done')],
      help: [say('helped')],
    });
    const sub = requests.find((request) => request.messages[0]?.content === 'help');

    expect(sub?.instructions).toContain('- review: REVIEW SKILL');
    expect(sub?.tools.map((tool) => tool.name)).toContain('read_skill');
  });

  describe('file locks', () => {
    it('are its own unless a set is given', async () => {
      const [first, second] = [await open(false), await open(false)];

      expect(first.fileLocks).not.toBe(second.fileLocks);
    });

    it('are the set it is given, so runs that share one take turns on a file', async () => {
      const shared = new FileLocks();
      const make = () =>
        createBackendHarness({
          provider: routedProvider({ hi: [say('hello')] }),
          title: 'hi',
          workspaceRoot: root,
          trustStore,
          env: process.env,
          fileLocks: shared,
          permissions: askingPermissions(),
        });
      const [first, second] = [await make(), await make()];

      expect(first.fileLocks).toBe(shared);
      expect(second.fileLocks).toBe(shared);
    });
  });

  describe('editing a file', () => {
    const edit = (id: string, oldText: string, newText: string) => () => [
      toolCall({ id, name: 'edit_file', input: { path: 'a.ts', oldText, newText } }),
      { type: 'done' as const, stopReason: 'tool_use' as const },
    ];
    const read = (id: string) => () => [
      toolCall({ id, name: 'read_file', input: { path: 'a.ts' } }),
      { type: 'done' as const, stopReason: 'tool_use' as const },
    ];

    /** Every tool result a run's model calls were sent, in the order first seen. */
    const resultsSeen = (requests: ProviderRequest[]) => {
      const seen = new Map<string, string>();

      for (const request of requests) {
        for (const message of request.messages) {
          if (message.role === 'tool') seen.set(message.toolCallId, message.content);
        }
      }

      return seen;
    };

    it('is refused until the agent has read the file, then allowed', async () => {
      await writeFile(path.join(root, 'a.ts'), 'one\n');

      const results = resultsSeen(
        await runPrompt({
          go: [edit('e1', 'one', 'two'), read('r1'), edit('e2', 'one', 'two'), say('done')],
        }),
      );

      expect(results.get('e1')).toContain('You have not read a.ts');
      expect(results.get('e2')).toContain('Edited a.ts');
      expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('two\n');
    });

    it('holds a sub-agent to its own reads: what its parent read does not count', async () => {
      await writeFile(path.join(root, 'a.ts'), 'one\n');

      const results = resultsSeen(
        await runPrompt({
          go: [read('parent-read'), startHelper, say('done')],
          help: [edit('child-edit', 'one', 'two'), say('helped')],
        }),
      );

      expect(results.get('parent-read')).toContain('one');
      expect(results.get('child-edit')).toContain('You have not read a.ts');
      expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('one\n');
    });
  });
});
