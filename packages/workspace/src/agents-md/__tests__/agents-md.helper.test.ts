import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { createAgentsMdHook, findAgentsFiles } from '../agents-md.helper.js';
import { agentsDirs, formatAgentsInstructions } from '../agents-md.utils.js';

/**
 * base/
 *   AGENTS.md                 (above the root: must never be read)
 *   project/
 *     AGENTS.md               root rules
 *     packages/core/          no AGENTS.md
 *     packages/core/src/
 *       AGENTS.md             core rules
 *     empty/AGENTS.md         whitespace only
 */
let base: string;
let root: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'agents-md-test-'));
  root = path.join(base, 'project');
  await mkdir(path.join(root, 'packages', 'core', 'src'), { recursive: true });
  await mkdir(path.join(root, 'empty'));
  await writeFile(path.join(base, 'AGENTS.md'), 'OUTSIDE THE PROJECT');
  await writeFile(path.join(root, 'AGENTS.md'), 'Use npm.\n');
  await writeFile(
    path.join(root, 'packages', 'core', 'src', 'AGENTS.md'),
    'Core imports zod only.\n',
  );
  await writeFile(path.join(root, 'empty', 'AGENTS.md'), '  \n');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('agentsDirs', () => {
  it('lists folders from the root down to cwd, root first', () => {
    expect(agentsDirs({ root: '/p', cwd: '/p/a/b' })).toEqual(['/p', '/p/a', '/p/a/b']);
    expect(agentsDirs({ root: '/p', cwd: '/p' })).toEqual(['/p']);
  });

  it('refuses a cwd outside the root', () => {
    expect(() => agentsDirs({ root: '/p', cwd: '/other' })).toThrow('outside the project root');
    expect(() => agentsDirs({ root: '/p', cwd: '/p/..' })).toThrow('outside the project root');
  });
});

describe('findAgentsFiles', () => {
  it('finds every AGENTS.md from the root down to cwd, root first, never above the root', async () => {
    const files = await findAgentsFiles({ root, cwd: path.join(root, 'packages', 'core', 'src') });

    expect(files).toEqual([
      { path: 'AGENTS.md', content: 'Use npm.\n' },
      {
        path: path.join('packages', 'core', 'src', 'AGENTS.md'),
        content: 'Core imports zod only.\n',
      },
    ]);
  });

  it('only reads the root file when cwd is the root', async () => {
    expect((await findAgentsFiles({ root, cwd: root })).map((file) => file.path)).toEqual([
      'AGENTS.md',
    ]);
  });

  it('finds nothing in a project without AGENTS.md', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'agents-md-bare-'));

    expect(await findAgentsFiles({ root: bare, cwd: bare })).toEqual([]);
    await rm(bare, { recursive: true, force: true });
  });
});

describe('formatAgentsInstructions', () => {
  it('labels each file with its path, root first, and skips empty files', () => {
    const text = formatAgentsInstructions({
      files: [
        { path: 'AGENTS.md', content: 'Use npm.\n' },
        { path: 'empty/AGENTS.md', content: '  \n' },
        { path: 'src/AGENTS.md', content: 'Be strict.' },
      ],
      maxChars: 10_000,
    });

    expect(text).toContain('## AGENTS.md\n\nUse npm.\n\n## src/AGENTS.md\n\nBe strict.');
    expect(text).not.toContain('empty/AGENTS.md');
    expect(text).toMatch(/more specific \(later\) one wins/);
  });

  it('returns undefined when there is nothing to say', () => {
    expect(formatAgentsInstructions({ files: [], maxChars: 100 })).toBeUndefined();
    expect(
      formatAgentsInstructions({ files: [{ path: 'AGENTS.md', content: '\n' }], maxChars: 100 }),
    ).toBeUndefined();
  });

  it('cuts at maxChars, with a note', () => {
    const text =
      formatAgentsInstructions({
        files: [{ path: 'AGENTS.md', content: 'x'.repeat(500) }],
        maxChars: 200,
      }) ?? '';

    expect(text).toMatch(/\[truncated: AGENTS\.md content was cut at 200 of \d+ characters\]$/);
    expect(text.length).toBeLessThan(300);
  });
});

describe('createAgentsMdHook in the loop', () => {
  it('appends AGENTS.md without changing the host system prompt', async () => {
    const requests: ProviderRequest[] = [];
    const scripted = scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]);
    const messages = await runAgent({
      provider: {
        stream: (request) => {
          requests.push(request);

          return scripted.stream(request);
        },
      },
      tools: [],
      instructions: 'You are a careful coding agent.',
      messages: [{ role: 'user', content: 'hi' }],
      hooks: [createAgentsMdHook({ root, cwd: path.join(root, 'packages', 'core', 'src') })],
    });

    const instructions = requests[0]?.messages[1]?.content ?? '';

    expect(requests[0]?.instructions).toBe('You are a careful coding agent.');
    expect(instructions).toContain('Project instructions');
    expect(instructions).toContain('Use npm.');
    expect(instructions).toContain('Core imports zod only.');
    expect(instructions).not.toContain('OUTSIDE THE PROJECT');
    expect(messages).toMatchObject([
      { role: 'user', content: 'hi' },
      { role: 'user', content: instructions },
      { role: 'assistant', content: '', toolCalls: [] },
    ]);
    expect(messages).toHaveLength(3);
  });

  it('re-reads AGENTS.md each turn, so an edit applies on the next model call', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'agents-md-live-'));
    const requests: ProviderRequest[] = [];
    const scripted = scriptedProvider([
      [
        toolCall({ id: '1', name: 'edit_rules', input: {} }),
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'done', stopReason: 'end_turn' }],
    ]);

    await writeFile(path.join(project, 'AGENTS.md'), 'Rule v1');
    await runAgent({
      provider: {
        stream: (request) => {
          requests.push(request);

          return scripted.stream(request);
        },
      },
      tools: [
        {
          name: 'edit_rules',
          description: 'Edits AGENTS.md',
          inputSchema: (await import('zod')).z.object({}),
          execute: async () => {
            await writeFile(path.join(project, 'AGENTS.md'), 'Rule v2');

            return 'ok';
          },
        },
      ],
      messages: [{ role: 'user', content: 'go' }],
      hooks: [createAgentsMdHook({ root: project })],
    });

    expect(requests[0]?.messages[1]?.content).toContain('Rule v1');
    expect(requests[1]?.messages.at(-1)?.content).toContain('Rule v2');
    expect(requests[1]?.messages.slice(0, 2)).toEqual(requests[0]?.messages);
    expect(requests.map((request) => request.instructions)).toEqual([undefined, undefined]);
    await rm(project, { recursive: true, force: true });
  });
});
