import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readSkillFile, skillRequest } from '../skill-files.helper.js';
import { findSkills } from '../skills.helper.js';
import { skillFile, useSkillFolders } from '../../testing/skills.fake.js';

const SECRET_MARKER = 'SECRET_MARKER_FOR_THE_TEST';
const folders = useSkillFolders();
let root: string;

/** The text of the error `run` rejects with, or '' when it returns. */
async function refusal(run: Promise<unknown>): Promise<string> {
  return run.then(
    () => '',
    (caughtError: unknown) => (caughtError as Error).message,
  );
}

beforeAll(async () => {
  root = path.join(folders.base, 'env-project');
  const skills = path.join(root, '.sheavly/skills');

  // `leaky`: a SKILL.md that links to a `.env` which is itself a valid skill file.
  await mkdir(path.join(skills, 'leaky'), { recursive: true });
  await writeFile(
    path.join(skills, 'leaky/.env'),
    skillFile({ name: 'leaky', description: SECRET_MARKER }),
  );
  await symlink('.env', path.join(skills, 'leaky/SKILL.md'));

  // `fine`: an ordinary skill with a plain file, a `.env` and a link to one.
  await mkdir(path.join(skills, 'fine/sub'), { recursive: true });
  await writeFile(
    path.join(skills, 'fine/SKILL.md'),
    skillFile({ name: 'fine', description: 'Fine.' }),
  );
  await writeFile(path.join(skills, 'fine/notes.md'), 'NOTES');
  await writeFile(path.join(skills, 'fine/.env'), SECRET_MARKER);
  await writeFile(path.join(skills, 'fine/sub/.env.local'), SECRET_MARKER);
  await symlink('.env', path.join(skills, 'fine/link.md'));
});

describe('a skill folder with a .env file', () => {
  it('findSkills reports a SKILL.md that links to .env as a problem and never loads it', async () => {
    const found = await findSkills({ root });

    expect(found.skills.map((skill) => skill.name)).not.toContain('leaky');
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]?.reason).toContain('.env files is not allowed');
    expect(JSON.stringify(found)).not.toContain(SECRET_MARKER);
  });

  it('skillRequest does not run that skill and never sends its text', async () => {
    const request = await skillRequest({ root, prompt: { text: 'go /leaky' } });

    expect(request.skills).toEqual([]);
    expect(request.unknown).toEqual(['leaky']);
    expect(JSON.stringify(request)).not.toContain(SECRET_MARKER);
  });

  it('readSkillFile refuses .env, a nested .env.local and a link to .env', async () => {
    for (const file of ['.env', 'sub/.env.local', 'link.md']) {
      const message = await refusal(readSkillFile({ root, name: 'fine', file }));

      expect(message).toContain('.env files is not allowed');
      expect(message).not.toContain(SECRET_MARKER);
    }
  });

  it('readSkillFile still reads an ordinary file and the SKILL.md', async () => {
    expect((await readSkillFile({ root, name: 'fine', file: 'notes.md' }))?.text).toBe('NOTES');
    expect((await readSkillFile({ root, name: 'fine' }))?.text).toContain('Fine.');
  });
});
