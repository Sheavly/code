import { describe, expect, it } from 'vitest';
import type { Skill } from '@sheavly/workspace/skills/skills.types';
import { projectTrustNotice, skillsNotice } from '../render.utils.js';

describe('projectTrustNotice', () => {
  it('says why .sheavly/ hooks were skipped, and how to trust them', () => {
    expect(projectTrustNotice('untrusted')).toMatch(/not trusted.*--trust/);
    expect(projectTrustNotice('changed')).toMatch(/changed since you trusted.*--trust/);
  });

  it('says nothing when the hooks ran or there were none', () => {
    expect(projectTrustNotice('trusted')).toBeUndefined();
    expect(projectTrustNotice('no_hooks')).toBeUndefined();
  });
});

describe('skillsNotice', () => {
  const skill = (dir: string, scope: Skill['scope']): Skill => ({
    name: 'create-skill',
    description: '',
    manualOnly: false,
    dir,
    scope,
  });

  it('lists skills that did not load, and skills another with their name hides', () => {
    const text = skillsNotice({
      problems: [{ path: '/p/.agents/skills/x/SKILL.md', reason: 'it has no --- frontmatter' }],
      hidden: [
        {
          skill: skill('/home/.agents/skills/create-skill', 'user'),
          by: skill('/built-in/create-skill', 'built-in'),
        },
      ],
    });

    expect(text).toBe(
      '⚠ skill not loaded: /p/.agents/skills/x/SKILL.md: it has no --- frontmatter\n' +
        '→ skill create-skill in /home/.agents/skills/create-skill is hidden by the built-in one in /built-in/create-skill',
    );
  });

  it('says nothing when every skill loaded and none is hidden', () => {
    expect(skillsNotice({ problems: [], hidden: [] })).toBeUndefined();
  });
});
