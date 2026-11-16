import { describe, expect, it } from 'vitest';
import { skillInfoSchema, skillNameSchema, skillScopeSchema } from '../skill.validator.js';

describe('skillNameSchema', () => {
  it.each(['git', 'review-bugbot', 'a1-b2-c3'])('accepts %s', (name) => {
    expect(skillNameSchema.parse(name)).toBe(name);
  });

  it.each(['', 'Git', 'two--dashes', '-lead', 'trail-', 'has space', 'under_score', '../x'])(
    'rejects %j, so a name cannot be a path or a menu entry in another shape',
    (name) => {
      expect(skillNameSchema.safeParse(name).success).toBe(false);
    },
  );
});

describe('skillScopeSchema and skillInfoSchema', () => {
  it('knows project, user and built-in skills and no other scope', () => {
    expect(skillScopeSchema.options).toEqual(['project', 'user', 'built-in']);
    expect(skillScopeSchema.safeParse('global').success).toBe(false);
  });

  it('lists a skill by name, description and scope, never its body', () => {
    const info = { name: 'git', description: 'Git work', manualOnly: false, scope: 'project' };

    expect(skillInfoSchema.parse({ ...info, body: 'secret instructions' })).toEqual(info);
  });
});
