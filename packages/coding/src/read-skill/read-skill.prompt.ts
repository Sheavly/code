export const READ_SKILL_PROMPTS = {
  description:
    'Read a skill from the skills list: its SKILL.md (the default), or a file in its folder ' +
    'that SKILL.md links to, by its path relative to the folder. ' +
    'Returns the complete file without line or character limits.',
  name: 'The skill’s name, as in the skills list',
  file: 'A file in the skill’s folder, relative to it (default SKILL.md)',
};
