import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSkillsHook, findSkills } from '../skills.helper.js';
import { skillFile, useSkillFolders } from '../../testing/skills.fake.js';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';

const folders = useSkillFolders();
let base: string;
let root: string;
let home: string;

beforeAll(() => {
  base = folders.base;
  root = folders.root;
  home = folders.home;
});

describe('findSkills', () => {
  it('finds skills in all four folders; project over user, .sheavly over .agents', async () => {
    const { skills } = await findSkills({ root, home });
    const byName = Object.fromEntries(skills.map((skill) => [skill.name, skill]));

    expect(Object.keys(byName).sort()).toEqual([
      'create-skill',
      'deploy',
      'git',
      'lint',
      'notes',
      'review',
    ]);
    expect(byName.review?.description).toBe('Project sheavly review.');
    expect(byName.lint).toMatchObject({ description: 'Project lint.', scope: 'project' });
    expect(byName.deploy).toMatchObject({ description: 'User sheavly deploy.', scope: 'user' });
    expect(byName.notes?.dir).toBe(path.join(home, '.agents/skills/notes'));
    expect(byName.git?.manualOnly).toBe(true);
  });

  it('reports a skill that does not load with its path and why; the others still load', async () => {
    const { problems } = await findSkills({ root, home });

    expect(problems).toEqual([
      {
        path: path.join(root, '.agents/skills/broken/SKILL.md'),
        reason: 'it has no --- frontmatter',
      },
      {
        path: path.join(root, '.agents/skills/misnamed/SKILL.md'),
        reason: 'name "other" is not its folder\'s name',
      },
    ]);
  });

  it('reads a symlinked skill folder as the folder it points to', async () => {
    const linked = path.join(root, '.agents/skills/linked');

    await mkdir(path.join(base, 'elsewhere/linked'), { recursive: true });
    await writeFile(
      path.join(base, 'elsewhere/linked/SKILL.md'),
      skillFile({ name: 'linked', description: 'Linked in.' }),
    );
    await symlink(path.join(base, 'elsewhere/linked'), linked);

    await symlink(path.join(root, 'secret.txt'), path.join(root, '.agents/skills/README.md'));
    await symlink(path.join(base, 'gone'), path.join(root, '.agents/skills/broken-link'));

    const found = await findSkills({ root, home });

    expect(found.skills.find((skill) => skill.name === 'linked')?.description).toBe('Linked in.');
    // A symlink to a file, or a broken one, is not a skill and not a problem.
    expect(found.problems.map((problem) => problem.path).join()).not.toMatch(/README|broken-link/);
    await rm(linked);
    await rm(path.join(root, '.agents/skills/README.md'));
    await rm(path.join(root, '.agents/skills/broken-link'));
  });

  it('reports a skill it cannot read, or whose SKILL.md points out of its folder', async () => {
    const escaping = path.join(root, '.agents/skills/escaping');
    const folderAsFile = path.join(root, '.agents/skills/folder-as-file');

    await mkdir(escaping, { recursive: true });
    await symlink(path.join(root, 'secret.txt'), path.join(escaping, 'SKILL.md'));
    await mkdir(path.join(folderAsFile, 'SKILL.md'), { recursive: true });

    const { skills, problems } = await findSkills({ root, home });

    expect(problems.map((problem) => problem.path)).toEqual(
      expect.arrayContaining([
        path.join(escaping, 'SKILL.md'),
        path.join(folderAsFile, 'SKILL.md'),
      ]),
    );
    expect(problems.find((p) => p.path.startsWith(escaping))?.reason).toMatch(
      /can't be read: .*outside/,
    );
    expect(skills.some((skill) => skill.name === 'review')).toBe(true); // the others still load
    await rm(escaping, { recursive: true });
    await rm(folderAsFile, { recursive: true });
  });

  it('reads only the project without a home, and only the built-ins where there are no skills', async () => {
    const { skills } = await findSkills({ root });
    const bare = await findSkills({ root: path.join(base, 'missing') });

    expect(skills.every((skill) => skill.scope !== 'user')).toBe(true);
    expect(bare.problems).toEqual([]);
    expect(bare.skills.map(({ name, scope }) => `${scope}:${name}`)).toEqual([
      'built-in:create-skill',
    ]);
  });

  it('keeps a built-in over ~/.agents/skills, where other agents install theirs', async () => {
    const theirs = path.join(home, '.agents/skills/create-skill');

    await mkdir(theirs, { recursive: true });
    await writeFile(
      path.join(theirs, 'SKILL.md'),
      skillFile({ name: 'create-skill', description: 'Cursor’s.' }),
    );

    const { skills, hidden } = await findSkills({ root, home });

    expect(skills.find((skill) => skill.name === 'create-skill')?.scope).toBe('built-in');
    expect(hidden).toContainEqual({
      skill: expect.objectContaining({ dir: theirs }) as unknown,
      by: expect.objectContaining({ scope: 'built-in' }) as unknown,
    });
    await rm(theirs, { recursive: true });
  });

  it('lets ~/.sheavly/skills or the project replace a built-in', async () => {
    for (const [base_, scope] of [
      [path.join(home, '.sheavly'), 'user'],
      [path.join(root, '.agents'), 'project'],
    ] as const) {
      const mine = path.join(base_, 'skills/create-skill');

      await mkdir(mine, { recursive: true });
      await writeFile(
        path.join(mine, 'SKILL.md'),
        skillFile({ name: 'create-skill', description: 'Mine.' }),
      );

      const { skills } = await findSkills({ root, home });

      expect(skills.find((skill) => skill.name === 'create-skill')).toMatchObject({
        description: 'Mine.',
        scope,
      });
      await rm(mine, { recursive: true });
    }
  });

  it('reports each skill another with its name hides, and which one won', async () => {
    const { hidden } = await findSkills({ root, home });

    expect(hidden.map(({ skill, by }) => `${skill.dir} < ${by.dir}`).sort()).toEqual(
      [
        `${path.join(root, '.agents/skills/review')} < ${path.join(root, '.sheavly/skills/review')}`,
        `${path.join(home, '.agents/skills/deploy')} < ${path.join(home, '.sheavly/skills/deploy')}`,
        `${path.join(home, '.sheavly/skills/lint')} < ${path.join(root, '.agents/skills/lint')}`,
      ].sort(),
    );
  });

  it('loads this repo’s own skills in .agents/skills unchanged', async () => {
    const repo = path.resolve(import.meta.dirname, '../../../../..');
    const { skills, problems } = await findSkills({ root: repo });

    expect(problems).toEqual([]);
    expect(skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(['git', 'sheavly-packages', 'sheavly']),
    );
  });
});

describe('createSkillsHook in the loop', () => {
  it('appends the full catalog when descriptions total more than 8,000 characters', async () => {
    const project = path.join(base, 'large-catalog');
    const names = Array.from(
      { length: 30 },
      (_, index) => `skill-${String(index).padStart(2, '0')}`,
    );
    const description = 'Detailed guidance. '.repeat(20).trimEnd();

    await Promise.all(
      names.map(async (name) => {
        const dir = path.join(project, '.agents/skills', name);

        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, 'SKILL.md'),
          skillFile({ name, description }, 'PRIVATE BODY'),
        );
      }),
    );

    const messages = await runAgent({
      provider: scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]),
      tools: [],
      messages: [{ role: 'user', content: 'Which skills are available?' }],
      hooks: [createSkillsHook({ root: project })],
    });
    const added = messages[1];
    const instructions = added?.role === 'user' ? added.content : '';

    expect(instructions.length).toBeGreaterThan(8000);
    expect(instructions).toContain(names.map((name) => `- ${name}: ${description}`).join('\n'));
    expect(instructions).not.toContain('more skills not listed');
    expect(instructions).not.toContain('PRIVATE BODY');
  });

  it('lists the skills in the instructions of every model call, never their bodies', async () => {
    const requests: ProviderRequest[] = [];
    const scripted = scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]);

    await runAgent({
      provider: {
        stream: (request) => {
          requests.push(request);

          return scripted.stream(request);
        },
      },
      tools: [],
      messages: [{ role: 'user', content: 'hi' }],
      hooks: [createSkillsHook({ root, home })],
    });

    const instructions = requests[0]?.messages[1]?.content ?? '';

    expect(instructions).toContain('- review: Project sheavly review.');
    expect(instructions).toContain('- notes: User notes.');
    expect(instructions).toContain('- create-skill: Creates or improves an agent skill');
    expect(instructions).not.toContain('- git:');
    expect(instructions).not.toContain('checklist.md');
  });
});
