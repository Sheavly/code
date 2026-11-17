import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readSkillFile, skillRequest } from '../skill-files.helper.js';
import { UnknownSkillError } from '../../errors/skills.errors.js';
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
      const request = await skillRequest({ root, home, prompt: { text } });

      expect(request.skills).toEqual(['git']);
      expect(request.text).toContain('Do git things.');
      expect(request.text).not.toContain('disable-model-invocation');
      expect(request.text.endsWith(`\n\n${text}`)).toBe(true);
    }
  });

  it('runs every skill a message mentions, and names the mentions no skill has', async () => {
    const request = await skillRequest({
      root,
      home,
      prompt: { text: '/review it, then /nope and /git' },
    });

    expect(request.skills).toEqual(['review', 'git']);
    expect(request.unknown).toEqual(['nope']);
    // What the user typed, kept for a UI: known skills as chips, an unknown /nope as text.
    expect(request.parts).toEqual([
      { type: 'skill', name: 'review' },
      { type: 'text', text: ' it, then /nope and ' },
      { type: 'skill', name: 'git' },
    ]);
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
    const request = await skillRequest({
      root,
      prompt: { text: 'make a skill for PR reviews /create-skill' },
    });

    expect(request.skills).toEqual(['create-skill']);
    expect(request.text).toContain('# Creating a skill');
  });

  it('sends a message without a known skill unchanged', async () => {
    for (const text of ['/nope', 'git submit', 'look in /usr/bin', '/Git']) {
      const request = await skillRequest({ root, home, prompt: { text } });

      expect(request.text).toBe(text);
      expect(request.skills).toEqual([]);
      expect(request.parts).toBeUndefined();
    }

    expect((await skillRequest({ root, home, prompt: { text: 'try /nope' } })).unknown).toEqual([
      'nope',
    ]);
  });

  it('runs exactly the skills picked as parts, and none a /name in their text mentions', async () => {
    const request = await skillRequest({
      root,
      home,
      prompt: {
        parts: [
          { type: 'text', text: 'please ' },
          { type: 'skill', name: 'git' },
          { type: 'text', text: ' and look at /review' },
        ],
      },
    });

    expect(request.skills).toEqual(['git']);
    expect(request.text).toContain('## Skill: git');
    expect(request.text).not.toContain('## Skill: review');
    expect(request.text.endsWith('\n\nplease /git and look at /review')).toBe(true);
    expect(request.parts).toHaveLength(3);
  });

  it('refuses parts that pick a skill no one has: the UI’s list is stale', async () => {
    await expect(
      skillRequest({ root, home, prompt: { parts: [{ type: 'skill', name: 'nope' }] } }),
    ).rejects.toThrow(UnknownSkillError);
  });

  it('sends parts without a skill as their text', async () => {
    const request = await skillRequest({
      root,
      home,
      prompt: { parts: [{ type: 'text', text: 'just /review text' }] },
    });

    expect(request).toEqual({ text: 'just /review text', skills: [], unknown: [] });
  });
});
