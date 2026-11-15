import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { createInstructionHook } from '../../instruction-context/instruction-source.helper.js';
import { agentsMdSource, findAgentsFiles } from '../agents-md.helper.js';
import { agentsDirs, formatAgentsInstructions } from '../agents-md.utils.js';

const agentsMdHook = (options: Parameters<typeof agentsMdSource>[0]) =>
  createInstructionHook(agentsMdSource(options)).hook;

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

/** Each folder of `project` holds a refused AGENTS.md, so only the root file is found from it. */
async function expectOnlyRootRules(params: { project: string; dirs: string[] }) {
  const { project, dirs } = params;

  for (const dir of dirs) {
    const files = await findAgentsFiles({ root: project, cwd: path.join(project, dir) });

    expect(files).toEqual([{ path: 'AGENTS.md', content: 'Real rules' }]);
  }
}

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

  it('skips an AGENTS.md that is a symlink out of the root, or to a .env file', async () => {
    const project = path.join(base, 'linked');

    await mkdir(path.join(project, 'leaks'), { recursive: true });
    await writeFile(path.join(project, '.env'), 'SECRET=1');
    await writeFile(path.join(project, 'AGENTS.md'), 'Real rules');
    await symlink(path.join(base, 'AGENTS.md'), path.join(project, 'leaks', 'AGENTS.md'));
    await mkdir(path.join(project, 'env'));
    await symlink(path.join(project, '.env'), path.join(project, 'env', 'AGENTS.md'));

    await expectOnlyRootRules({ project, dirs: ['leaks', 'env'] });
  });

  it('refuses a symlinked folder out of the root, a .env.local chain and a loop', async () => {
    const project = path.join(base, 'chained');
    const outside = path.join(base, 'chained-outside');

    await mkdir(path.join(project, 'via'), { recursive: true });
    await mkdir(path.join(project, 'chain'), { recursive: true });
    await mkdir(path.join(project, 'loop'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(project, 'AGENTS.md'), 'Real rules');
    await writeFile(path.join(outside, 'AGENTS.md'), 'Foreign rules');
    await writeFile(path.join(project, '.env.local'), 'SECRET=1');
    await rm(path.join(project, 'via'), { recursive: true });
    await symlink(outside, path.join(project, 'via'));
    await symlink(path.join(project, '.env.local'), path.join(project, 'chain', 'hop'));
    await symlink(path.join(project, 'chain', 'hop'), path.join(project, 'chain', 'AGENTS.md'));
    await symlink(path.join(project, 'loop', 'AGENTS.md'), path.join(project, 'loop', 'AGENTS.md'));

    await expectOnlyRootRules({ project, dirs: ['via', 'chain', 'loop'] });
  });

  it('takes the sibling worktree as the boundary, so a link into the main checkout is refused', async () => {
    const main = path.join(base, 'sibling-main');
    const worktree = path.join(base, 'sibling-wt');

    await mkdir(main, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(main, 'AGENTS.md'), 'Main rules');
    await symlink(path.join(main, 'AGENTS.md'), path.join(worktree, 'AGENTS.md'));

    const text = await agentsMdSource({ root: main }).resolve({
      signal: new AbortController().signal,
      workingRoot: worktree,
    });

    expect(text).toBeUndefined();
  });

  it('follows a symlink that stays inside the root', async () => {
    const project = path.join(base, 'inner-link');

    await mkdir(path.join(project, 'docs'), { recursive: true });
    await writeFile(path.join(project, 'docs', 'rules.md'), 'Inner rules');
    await symlink(path.join(project, 'docs', 'rules.md'), path.join(project, 'AGENTS.md'));

    expect(await findAgentsFiles({ root: project, cwd: project })).toEqual([
      { path: 'AGENTS.md', content: 'Inner rules' },
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
    });

    expect(text).toBe(
      'Project instructions from AGENTS.md files. Each applies to its folder and everything ' +
        'below it; where they disagree, the more specific (later) one wins.\n\n' +
        '## AGENTS.md\n\nUse npm.\n\n## src/AGENTS.md\n\nBe strict.',
    );
  });

  it('returns undefined when there is nothing to say', () => {
    expect(formatAgentsInstructions({ files: [] })).toBeUndefined();
    expect(
      formatAgentsInstructions({ files: [{ path: 'AGENTS.md', content: '\n' }] }),
    ).toBeUndefined();
  });

  it('keeps all instructions from a file larger than 32,000 characters', () => {
    const content = `${'x'.repeat(40_000)}\nFINAL RULE`;
    const text =
      formatAgentsInstructions({
        files: [{ path: 'AGENTS.md', content }],
      }) ?? '';

    expect(text).toContain(content);
    expect(text.endsWith('FINAL RULE')).toBe(true);
    expect(text).not.toContain('[truncated:');
  });
});

describe('agentsMdSource with a project root reached through a symlink', () => {
  it('reads the root and its cwd without a working root', async () => {
    const real = path.join(base, 'real-project');
    const link = path.join(base, 'linked-project');

    await mkdir(path.join(real, 'nested'), { recursive: true });
    await writeFile(path.join(real, 'AGENTS.md'), 'Root rules');
    await writeFile(path.join(real, 'nested', 'AGENTS.md'), 'Nested rules');
    await symlink(real, link);

    const text = await agentsMdSource({ root: link, cwd: path.join(link, 'nested') }).resolve({
      signal: new AbortController().signal,
      workingRoot: undefined,
    });

    expect(text).toContain('Root rules');
    expect(text).toContain('Nested rules');
  });
});

describe('the AGENTS.md hook in the loop', () => {
  it.each([20_000, 40_000])(
    'loads root and nested instructions with a %i-character root file',
    async (length) => {
      const project = path.join(base, `large-${String(length)}`);
      const cwd = path.join(project, 'nested');
      const rootRules = `${'r'.repeat(length)}\nROOT FINAL RULE`;
      const nestedRules = `${'n'.repeat(20_000)}\nNESTED FINAL RULE`;

      await mkdir(cwd, { recursive: true });
      await writeFile(path.join(project, 'AGENTS.md'), rootRules);
      await writeFile(path.join(cwd, 'AGENTS.md'), nestedRules);

      const messages = await runAgent({
        provider: scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]),
        tools: [],
        messages: [{ role: 'user', content: 'hi' }],
        hooks: [agentsMdHook({ root: project, cwd })],
      });
      const added = messages[1];
      const instructions = added?.role === 'user' ? added.content : '';

      expect(instructions).toContain(
        `## AGENTS.md\n\n${rootRules}\n\n## nested/AGENTS.md\n\n${nestedRules}`,
      );
      expect(instructions).not.toContain('[truncated:');
    },
  );

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
      hooks: [agentsMdHook({ root, cwd: path.join(root, 'packages', 'core', 'src') })],
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
      hooks: [agentsMdHook({ root: project })],
    });

    expect(requests[0]?.messages[1]?.content).toContain('Rule v1');
    expect(requests[1]?.messages.at(-1)?.content).toContain('Rule v2');
    expect(requests[1]?.messages.slice(0, 2)).toEqual(requests[0]?.messages);
    expect(requests.map((request) => request.instructions)).toEqual([undefined, undefined]);
    await rm(project, { recursive: true, force: true });
  });
});
