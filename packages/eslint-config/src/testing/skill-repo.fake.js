// Test-only: a throwaway repo holding one skill, for the tests of what reads `harness.json`.
import { rmSync } from 'node:fs';
import { afterEach } from 'vitest';
import { SKILL_METADATA_FILE, SKILLS_DIR } from '../skills.js';
import { tempWorkspace } from './workspace.fake.js';

/**
 * Call once in a test file. Returns `repoWithSkill`, which makes a repo holding one skill
 * `zz-skill` with `metadata` (left out when undefined) and the `extra` files, and removes every
 * repo it made after each test.
 */
export function useSkillRepos() {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  return function repoWithSkill(params) {
    const { metadata, extra = {} } = params;
    const dir = `${SKILLS_DIR}/zz-skill`;
    const root = tempWorkspace({
      [`${dir}/SKILL.md`]: '---\nname: zz-skill\n---\n',
      ...(metadata === undefined ? {} : { [`${dir}/${SKILL_METADATA_FILE}`]: metadata }),
      ...extra,
    });

    roots.push(root);

    return root;
  };
}
