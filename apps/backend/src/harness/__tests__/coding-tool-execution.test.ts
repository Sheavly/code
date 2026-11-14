import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { memoryTrust } from '@sheavly/workspace/testing/trust.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { askingPermissions } from '../../testing/permissions.fake.js';
import { untilSettled } from '../../testing/settled.fake.js';
import { createBackendHarness } from '../harness.helper.js';

// Protected paths contain only invented source data, never user credentials or repository files.
const temp = useTempWorkspace({
  prefix: 'backend-coding-execution-',
  perTest: true,
  files: {
    'src/example.ts': 'export const fixtureNeedle = 1;\n',
    'main-delete.txt': 'main deletion fixture\n',
    'child-delete.txt': 'child deletion fixture\n',
    '.env.fixture': 'fixtureNeedle=syntheticProtectedData\n',
    '.git/config': 'fixtureNeedle syntheticGitData\n',
  },
  outside: { 'outside.txt': 'fixtureNeedle syntheticOutsideData\n' },
});

const step = (id: string, name: string, input: Record<string, unknown> = {}) =>
  calls(toolCall({ id, name, input }));
const startChild = step('start-child', 'start_agent', { title: 'Child', task: 'child' });

/** Exercises the actual backend composition and loop, retaining each session's model inputs. */
async function runPrompt(params: {
  scripts: Record<string, Script[]>;
  beforeRequest?: (request: ProviderRequest) => Promise<void>;
}) {
  const requests: ProviderRequest[] = [];
  const scripted = routedProvider(params.scripts);
  const provider: Provider = {
    async *stream(request) {
      await params.beforeRequest?.(request);
      yield* scripted.stream(request);
    },
  };
  const harness = await createBackendHarness({
    provider,
    title: 'main',
    workspaceRoot: temp.root,
    env: {},
    permissions: askingPermissions(),
    trustStore: new TrustStore({
      persistence: memoryTrust({ file: path.join(temp.base, 'trust.json') }),
    }),
    onModelCall: (request) => requests.push(request),
  });
  const conversation = createConversation({
    harness,
    tools: harness.tools,
    hooks: harness.hooks,
    run: streamAgent,
  });

  try {
    for await (const _event of conversation.send('main'));
    await untilSettled({ harness, conversation });
  } finally {
    await conversation.close();
  }

  return requests;
}

function resultsSeen(requests: ProviderRequest[]) {
  const results = new Map<string, { content: string; isError?: boolean }>();

  for (const request of requests) {
    for (const message of request.messages) {
      if (message.role === 'tool') results.set(message.toolCallId, message);
    }
  }

  return results;
}

function scriptFor(actor: string, scripts: Script[]) {
  if (actor === 'main') return { main: [...scripts, say('finished')] };

  return { main: [startChild, say('finished')], child: [...scripts, say('child finished')] };
}

function taskFrom(request: ProviderRequest, callId: string): string {
  const result = request.messages.find(
    (message) => message.role === 'tool' && message.toolCallId === callId,
  );
  const match = result?.content.match(/background task (t\d+)/);

  if (!match) throw new Error(`No task id in result of ${callId}`);

  return match[1]!;
}

describe.each(['main', 'child'])('backend coding tools in the %s session', (actor) => {
  it('runs glob and grep and deletes an unread fixture with the composed tools', async () => {
    const scripts = [
      step('find-files', 'glob', { pattern: '*.ts', path: 'src' }),
      step('find-content', 'grep', { pattern: 'fixtureNeedle', path: 'src' }),
      step('delete-unread', 'delete_file', { path: `${actor}-delete.txt` }),
    ];
    const results = resultsSeen(await runPrompt({ scripts: scriptFor(actor, scripts) }));

    expect(results.get('find-files')).toMatchObject({ isError: false });
    expect(results.get('find-files')?.content).toContain('src/example.ts');
    expect(results.get('find-content')).toMatchObject({ isError: false });
    expect(results.get('find-content')?.content).toBe(
      'src/example.ts:1:export const fixtureNeedle = 1;',
    );
    expect(results.get('delete-unread')).toMatchObject({ isError: false });
    expect(results.get('delete-unread')?.content).toContain(`Deleted ${actor}-delete.txt`);
    await expect(stat(path.join(temp.root, `${actor}-delete.txt`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps glob and grep confined and excludes protected fixture paths', async () => {
    const paths = [
      '../outside.txt',
      path.join(temp.base, 'outside.txt'),
      '.git/config',
      '.env.fixture',
    ];
    const scripts = paths.flatMap((target, index) => [
      step(`glob-guard-${index}`, 'glob', { pattern: '*', path: target }),
      step(`grep-guard-${index}`, 'grep', { pattern: 'fixtureNeedle', path: target }),
    ]);

    scripts.push(
      step('walk-files', 'glob', { pattern: '**' }),
      step('walk-content', 'grep', { pattern: 'fixtureNeedle' }),
      step('ask-protected-files', 'glob', { pattern: '.env*' }),
      step('ask-protected-content', 'grep', { pattern: 'fixtureNeedle', glob: '.git/**' }),
    );

    const results = resultsSeen(await runPrompt({ scripts: scriptFor(actor, scripts) }));
    const reasons = [
      'Path is outside the workspace',
      'Path is outside the workspace',
      'Searching inside .git is not allowed',
      'Searching .env files is not allowed',
    ];

    for (const [index, reason] of reasons.entries()) {
      for (const tool of ['glob', 'grep']) {
        expect(results.get(`${tool}-guard-${index}`)).toMatchObject({ isError: true });
        expect(results.get(`${tool}-guard-${index}`)?.content).toContain(reason);
      }
    }

    for (const id of [
      'walk-files',
      'walk-content',
      'ask-protected-files',
      'ask-protected-content',
    ]) {
      const result = results.get(id);

      expect(result).toMatchObject({ isError: false });
      expect(result?.content).not.toMatch(
        /syntheticProtectedData|syntheticGitData|syntheticOutsideData/,
      );
    }

    expect(results.get('walk-files')?.content).not.toMatch(
      /\.env\.fixture|\.git\/config|outside\.txt/,
    );
    expect(results.get('walk-content')?.content).toBe(
      'src/example.ts:1:export const fixtureNeedle = 1;',
    );
  });
});

describe('backend child state isolation', () => {
  it('does not inherit parent reads, and child deletion invalidates the parent read even after identical recreation', async () => {
    const recreated = Promise.withResolvers<undefined>();
    const requests = await runPrompt({
      scripts: {
        main: [
          step('parent-write', 'write_file', { path: 'ledger.ts', content: 'one\n' }),
          step('parent-read', 'read_file', { path: 'ledger.ts' }),
          startChild,
          step('parent-stale-edit', 'edit_file', {
            path: 'ledger.ts',
            oldText: 'one',
            newText: 'two',
          }),
          step('parent-fresh-read', 'read_file', { path: 'ledger.ts' }),
          step('parent-fresh-edit', 'edit_file', {
            path: 'ledger.ts',
            oldText: 'one',
            newText: 'two',
          }),
          say('finished'),
        ],
        child: [
          step('child-unread-edit', 'edit_file', {
            path: 'ledger.ts',
            oldText: 'one',
            newText: 'wrong',
          }),
          step('child-delete', 'delete_file', { path: 'ledger.ts' }),
          step('child-recreate', 'write_file', { path: 'ledger.ts', content: 'one\n' }),
          say('recreated'),
        ],
      },
      beforeRequest: async (request) => {
        const results = resultsSeen([request]);

        if (results.has('child-recreate')) recreated.resolve(undefined);

        // A start result does not mean the child finished. Hold this model reply until its
        // actual recreate result is visible, so the stale edit cannot win the scheduling race.
        if (request.messages[0]?.content === 'main' && results.has('start-child')) {
          await recreated.promise;
        }
      },
    });
    const results = resultsSeen(requests);

    expect(results.get('parent-write')).toMatchObject({ isError: false });
    expect(results.get('parent-read')?.content).toContain('one');
    expect(results.get('child-unread-edit')).toMatchObject({ isError: true });
    expect(results.get('child-unread-edit')?.content).toContain('You have not read ledger.ts');
    expect(results.get('child-delete')).toMatchObject({ isError: false });
    expect(results.get('child-recreate')).toMatchObject({ isError: false });
    expect(results.get('parent-stale-edit')).toMatchObject({ isError: true });
    expect(results.get('parent-stale-edit')?.content).toContain('You have not read ledger.ts');
    expect(results.get('parent-fresh-edit')).toMatchObject({ isError: false });
    expect(await readFile(path.join(temp.root, 'ledger.ts'), 'utf8')).toBe('two\n');
  });

  it('uses the child registry for actual status and grouping despite overlapping task ids', async () => {
    const requests = await runPrompt({
      scripts: {
        main: [startChild, step('parent-status', 'task_status'), say('finished')],
        child: [
          step('child-empty-status', 'task_status'),
          step('start-leaf', 'start_agent', { title: 'Leaf', task: 'leaf' }),
          (request) =>
            calls(
              toolCall({
                id: 'child-group',
                name: 'await_tasks',
                input: {
                  ids: [taskFrom(request, 'start-leaf')],
                  reason: 'Leaf evidence belongs to child',
                },
              }),
            )(request),
          (request) =>
            calls(
              toolCall({
                id: 'child-status',
                name: 'task_status',
                input: { id: taskFrom(request, 'start-leaf') },
              }),
            )(request),
          say('child finished'),
        ],
        leaf: [step('leaf-empty-status', 'task_status'), say('leaf finished')],
      },
    });
    const results = resultsSeen(requests);

    expect(results.get('child-empty-status')).toMatchObject({
      isError: false,
      content: 'No background tasks.',
    });
    expect(results.get('leaf-empty-status')).toMatchObject({
      isError: false,
      content: 'No background tasks.',
    });
    expect(results.get('parent-status')).toMatchObject({ isError: false });
    expect(results.get('parent-status')?.content).toContain('sub-agent: Child');
    expect(results.get('parent-status')?.content).not.toContain('sub-agent: Leaf');
    expect(results.get('child-group')).toMatchObject({ isError: false });
    expect(results.get('child-group')?.content).toContain('Leaf evidence belongs to child');
    expect(results.get('child-status')).toMatchObject({ isError: false });
    expect(results.get('child-status')?.content).toContain('sub-agent: Leaf');
    expect(results.get('child-status')?.content).not.toContain('sub-agent: Child');
  });
});
