import type { Skill } from './skills.types.js';

/** Expects eligible skills in display order; descriptions remain runtime data. */
export function renderSkillsInstructions(params: {
  skills: readonly Pick<Skill, 'name' | 'description'>[];
}): string {
  const { skills } = params;
  const intro =
    'Skills: instructions for specific tasks. When a skill fits the task, read it first with ' +
    'read_skill (its SKILL.md, then the files it links to), and follow it. Read only what fits.';
  const descriptions = skills.map((skill) => `- ${skill.name}: ${skill.description}`);

  return [intro, ...descriptions].join('\n');
}

/** Skill bodies and the user's text are included unchanged, in the prepared order. */
export function renderSkillRequest(params: {
  skills: readonly { name: string; body: string }[];
  text: string;
}): string {
  const { skills, text } = params;
  const names = skills.map(({ name }) => name);
  const sections = skills.map(({ name, body }) => `## Skill: ${name}\n\n${body}`);
  const intro =
    `The user's message below runs ${names.length === 1 ? 'this skill' : 'these skills'} ` +
    `(${names.map((name) => `/${name}`).join(', ')}). Follow ${names.length === 1 ? 'its' : 'their'} ` +
    "instructions; read the files they link to with read_skill (the skill's name, and the file " +
    'relative to its folder).';

  return `${intro}\n\n${sections.join('\n\n')}\n\n---\n\n${text}`;
}
