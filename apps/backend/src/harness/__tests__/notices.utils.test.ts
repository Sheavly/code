import { describe, expect, it } from 'vitest';
import type { Skill } from '@sheavly/coding/skills/skills.types';
import { skillsNotice } from '../notices.utils.js';

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
