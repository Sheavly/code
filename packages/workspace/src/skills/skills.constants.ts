/** The file a skill folder holds its instructions in, with the frontmatter that names it. */
export const SKILL_FILE = 'SKILL.md';

/**
 * Where skills live, in precedence order inside one root (the project, then the user's home):
 * `.sheavly/skills/` before `.agents/skills/`, the agent-neutral folder other tools read too.
 */
export const SKILLS_FOLDERS = [
  ['.sheavly', 'skills'],
  ['.agents', 'skills'],
] as const;

/** A block scalar's indicator: `>` folds its lines into one, `|` keeps them; `-` / `+` chomping. */
export const BLOCK_SCALAR = /^[>|][+-]?$/;
