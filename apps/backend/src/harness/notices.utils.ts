import type { FoundSkills } from '@sheavly/workspace/skills/skills.types';

/**
 * What the backend prints about skills as it opens a conversation: each one that didn't load (its
 * path and why), and each one hidden by another with its name (which folder wins). Undefined when
 * neither.
 */
export function skillsNotice(found: Pick<FoundSkills, 'problems' | 'hidden'>): string | undefined {
  const lines = [
    ...found.problems.map(({ path, reason }) => `⚠ skill not loaded: ${path}: ${reason}`),
    ...found.hidden.map(
      ({ skill, by }) =>
        `→ skill ${skill.name} in ${skill.dir} is hidden by the ${by.scope} one in ${by.dir}`,
    ),
  ];

  return lines.length === 0 ? undefined : lines.join('\n');
}
