import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import type { SkillFolders } from './testing.types.js';

/** Test-only: a SKILL.md with this frontmatter and body. */
export const skillFile = (fields: Record<string, string>, body = 'Steps.') =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n\n${body}\n`;

/**
 * project/.sheavly/skills/  review (wins, links checklist.md; has a .env and an escaping symlink),
 *                           git (manual only)
 * project/.agents/skills/   review (loses to .sheavly), lint, broken, misnamed, assets (no SKILL.md)
 * home/.sheavly/skills/     lint (loses to the project's), deploy
 * home/.agents/skills/      deploy (loses to .sheavly), notes
 */
const FILES: Record<string, string> = {
  'project/.sheavly/skills/review/SKILL.md': skillFile(
    { name: 'review', description: 'Project sheavly review.' },
    'Read [the checklist](checklist.md).',
  ),
  'project/.sheavly/skills/review/checklist.md': 'CHECKLIST',
  'project/.sheavly/skills/review/.env': 'SECRET=1',
  'project/.sheavly/skills/git/SKILL.md': skillFile(
    { name: 'git', description: 'Git work.', 'disable-model-invocation': 'true' },
    'Do git things.',
  ),
  'project/.agents/skills/review/SKILL.md': skillFile({
    name: 'review',
    description: 'Project agents review.',
  }),
  'project/.agents/skills/lint/SKILL.md': skillFile({
    name: 'lint',
    description: 'Project lint.',
  }),
  'project/.agents/skills/broken/SKILL.md': '# no frontmatter',
  'project/.agents/skills/misnamed/SKILL.md': skillFile({ name: 'other', description: 'x' }),
  'project/.agents/skills/assets/logo.txt': 'not a skill',
  'project/secret.txt': 'OUTSIDE THE SKILL',
  'home/.sheavly/skills/lint/SKILL.md': skillFile({ name: 'lint', description: 'User lint.' }),
  'home/.sheavly/skills/deploy/SKILL.md': skillFile({
    name: 'deploy',
    description: 'User sheavly deploy.',
  }),
  'home/.agents/skills/deploy/SKILL.md': skillFile({
    name: 'deploy',
    description: 'User agents deploy.',
  }),
  'home/.agents/skills/notes/SKILL.md': skillFile({ name: 'notes', description: 'User notes.' }),
};

/**
 * Test-only: the project and home skill folders above, in a temp dir for the test file, removed
 * afterwards. Read `.root` and `.home` inside a test, never at module load.
 */
export function useSkillFolders(): SkillFolders {
  let opened: { base: string; root: string; home: string } | undefined;

  beforeAll(async () => {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), 'skills-test-')));
    const root = path.join(base, 'project');

    for (const [file, contents] of Object.entries(FILES)) {
      await mkdir(path.dirname(path.join(base, file)), { recursive: true });
      await writeFile(path.join(base, file), contents);
    }

    await symlink(
      path.join(root, 'secret.txt'),
      path.join(root, '.sheavly/skills/review/escape.md'),
    );
    opened = { base, root, home: path.join(base, 'home') };
  });
  afterAll(async () => {
    if (opened) await rm(opened.base, { recursive: true, force: true });
    opened = undefined;
  });

  const current = () => {
    if (!opened) throw new Error('useSkillFolders is only open while its tests run');

    return opened;
  };

  return {
    get base() {
      return current().base;
    },
    get root() {
      return current().root;
    },
    get home() {
      return current().home;
    },
  };
}
