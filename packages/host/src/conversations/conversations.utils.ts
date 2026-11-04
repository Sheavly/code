import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';

/** Whether `skill` matches `search`: its name or description has it, ignoring case. */
export function matchesSearch(params: { skill: SkillInfo; search: string }): boolean {
  const { skill, search } = params;
  const wanted = search.toLowerCase();

  return (
    skill.name.toLowerCase().includes(wanted) || skill.description.toLowerCase().includes(wanted)
  );
}
