import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readSkillFile, skillRequest } from '../skill-files.helper.js';
import { useSkillFolders } from '../../testing/skills.fake.js';

const folders = useSkillFolders();
let root: string;
let home: string;

beforeAll(() => {
  root = folders.root;
  home = folders.home;
});

describe('readSkillFile', () => {
  it('reads a skill’s SKILL.md and the files in its folder, from either location', async () => {
    expect((await readSkillFile({ root, home, name: 'review' }))?.text).toContain('checklist.md');
    expect((await readSkillFile({ root, home, name: 'review', file: 'checklist.md' }))?.text).toBe(
      'CHECKLIST',
    );
    expect((await readSkillFile({ root, home, name: 'notes' }))?.path).toBe(
      path.join(home, '.agents/skills/notes/SKILL.md'),
    );
  });

  it('reads a manual-only skill: the user ran it, so the model follows its links', async () => {
    expect((await readSkillFile({ root, home, name: 'git' }))?.text).toContain('Do git things.');
  });

  it('is undefined for an unknown skill, and refuses files outside the skill’s folder', async () => {
    expect(await readSkillFile({ root, home, name: 'nope' })).toBeUndefined();
    await expect(
      readSkillFile({ root, home, name: 'review', file: '../../../secret.txt' }),
    ).rejects.toThrow('outside the workspace');
    await expect(readSkillFile({ root, home, name: 'review', file: 'escape.md' })).rejects.toThrow(
      'outside the workspace',
    );
    await expect(readSkillFile({ root, home, name: 'review', file: 'gone.md' })).rejects.toThrow(
      'ENOENT',
    );
  });
});

describe('skillRequest', () => {
  it('runs a skill mentioned at the start, in the middle or at the end, with its body', async () => {
    for (const text of ['/git submit the PR', 'please /git submit the PR', 'submit the PR /git']) {
      const request = await skillRequest({ root, home, text });

      expect(request.skills).toEqual(['git']);
      expect(request.text).toContain('Do git things.');
      expect(request.text).not.toContain('disable-model-invocation');
      expect(request.text.endsWith(`\n\n${text}`)).toBe(true);
    }
  });

  it('runs every skill a message mentions, and names the mentions no skill has', async () => {
    const request = await skillRequest({ root, home, text: '/review it, then /nope and /git' });

    expect(request.skills).toEqual(['review', 'git']);
    expect(request.unknown).toEqual(['nope']);
    expect(request.text.indexOf('Project sheavly review')).toBe(-1); // bodies, not descriptions
    expect(request.text).toContain('## Skill: review');
    expect(request.text).toContain('## Skill: git');
  });

  it('can read every file the built-in create-skill links to', async () => {
    const skillMd = await readSkillFile({ root, name: 'create-skill' });
    const links = [...(skillMd?.text ?? '').matchAll(/\]\((references\/[\w.-]+\.md)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((file) => file !== 'references/checklist.md'); // the example skill's own link
    const linked = await Promise.all(
      links.map((file) => readSkillFile({ root, name: 'create-skill', file })),
    );

    expect(skillMd?.skill.scope).toBe('built-in');
    expect(new Set(links)).toEqual(new Set(['references/examples.md', 'references/patterns.md']));
    expect(linked.every((found) => (found?.text.length ?? 0) > 0)).toBe(true);
  });

  it('runs the built-in /create-skill', async () => {
    const request = await skillRequest({ root, text: 'make a skill for PR reviews /create-skill' });

    expect(request.skills).toEqual(['create-skill']);
    expect(request.text).toContain('# Creating a skill');
  });

  it('sends a message without a known skill unchanged', async () => {
    for (const text of ['/nope', 'git submit', 'look in /usr/bin', '/Git']) {
      const request = await skillRequest({ root, home, text });

      expect(request.text).toBe(text);
      expect(request.skills).toEqual([]);
    }

    expect((await skillRequest({ root, home, text: 'try /nope' })).unknown).toEqual(['nope']);
  });
});
