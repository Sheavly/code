import type { Skill, SkillCompletion, SkillMention } from './skills.types.js';
import { skillFrontmatterSchema } from './skills.validator.js';

/** A block scalar's indicator: `>` folds its lines into one, `|` keeps them; `-` / `+` chomping. */
const BLOCK_SCALAR = /^[>|][+-]?$/;

/** The `---` header's lines and what follows it, or undefined when the text has no header. */
function splitFrontmatter(text: string): { header: string[]; body: string } | string | undefined {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  if (lines[0]?.trim() !== '---') return undefined;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');

  if (end === -1) return 'the frontmatter has no closing ---';

  return { header: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/** One value on its key's line: `true` / `false` as booleans, surrounding quotes removed. */
function scalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  return raw.replace(/^(["'])(.*)\1$/, '$2');
}

/**
 * A value on the indented lines under its key: a block scalar (`>-` folded into one line, `|`
 * kept as lines), a `- item` list, or anything else (a nested map) as its trimmed lines.
 */
function nestedValue(params: { indicator: string; lines: string[] }): unknown {
  const items = params.lines.map((line) => line.trim()).filter((line) => line !== '');

  if (params.indicator.startsWith('>')) return items.join(' ');
  if (params.indicator.startsWith('|')) return items.join('\n');

  if (items.length > 0 && items.every((item) => item.startsWith('- '))) {
    return items.map((item) => scalar(item.slice(2).trim()));
  }

  return items.join('\n');
}

/**
 * The frontmatter at the top of a SKILL.md, or undefined when it has none: `key: value` lines,
 * with the YAML skills use under a key (`>-` / `|` text, `- item` lists) read from its indented
 * lines. A line that is neither makes the whole header unreadable (a string saying why).
 */
export function parseFrontmatter(text: string): Record<string, unknown> | string | undefined {
  const split = splitFrontmatter(text);

  if (split === undefined || typeof split === 'string') return split;

  const { header } = split;
  const fields: Record<string, unknown> = {};

  for (let index = 0; index < header.length; index++) {
    const line = header[index] ?? '';

    if (line.trim() === '' || line.startsWith('#')) continue;

    const match = /^([\w-]+):\s*(.*)$/.exec(line);

    if (!match) return `the frontmatter line "${line.trim()}" is not key: value`;

    const [, key = '', raw = ''] = match;
    const value = raw.trim();
    const lines: string[] = [];

    // The lines under a key are indented (YAML lists may also start at the margin with `- `).
    while (index + 1 < header.length && /^(\s|- |-$|$)/.test(header[index + 1] ?? '')) {
      lines.push(header[++index] ?? '');
    }

    fields[key] =
      value === '' || BLOCK_SCALAR.test(value)
        ? nestedValue({ indicator: value, lines })
        : scalar([value, ...lines.map((next) => next.trim()).filter(Boolean)].join(' '));
  }

  return fields;
}

/** A SKILL.md's instructions: everything after its frontmatter, trimmed. */
export function skillBody(text: string): string {
  const split = splitFrontmatter(text);

  return (typeof split === 'object' ? split.body : text).trim();
}

/**
 * The system instructions listing the skills the model may use: each name and what it is for.
 * Cut at `maxChars`, with a note saying how many were left out.
 */
export function formatSkillsInstructions(params: {
  skills: Skill[];
  maxChars: number;
}): string | undefined {
  const { skills, maxChars } = params;
  const offered = skills.filter((skill) => !skill.manualOnly);

  if (offered.length === 0) return undefined;

  const intro =
    'Skills: instructions for specific tasks. When a skill fits the task, read it first with ' +
    'read_skill (its SKILL.md, then the files it links to), and follow it. Read only what fits.';
  let text = intro;
  let listed = 0;

  for (const skill of offered) {
    const line = `\n- ${skill.name}: ${skill.description}`;

    if (text.length + line.length > maxChars) break;
    text += line;
    listed++;
  }

  const left = offered.length - listed;

  return left === 0
    ? text
    : `${text}\n[${String(left)} more skills not listed: the list is limited to ${String(maxChars)} characters]`;
}

/** A skill mention starts after the text's start, a space, or an opening bracket or quote. */
const MENTION_BEFORE = String.raw`(?<=^|[\s([{"'\x60])`;

/**
 * Every skill mention in a user's message: each `/<name>` anywhere in it (at the start, in the
 * middle or at the end), in order, with where it is (`start` at the `/`, `end` after the name).
 * A mention stands on its own: it ends at the text's end, a space or punctuation, so a path like
 * `/usr/bin` or a URL is never one. A UI highlights these; `skillRequest` runs the same ones, so
 * what is highlighted is what runs. Whether a skill has the name is for the caller to check.
 */
export function findSkillMentions(text: string): SkillMention[] {
  const pattern = new RegExp(
    String.raw`${MENTION_BEFORE}\/([a-z0-9-]+)(?=$|[\s.,;:!?)\]}"'\x60])`,
    'g',
  );

  return [...text.matchAll(pattern)]
    .map((match) => ({
      name: match[1] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    }))
    .filter(({ name }) => skillFrontmatterSchema.shape.name.safeParse(name).success);
}

/**
 * What to offer while the user types a skill name: the `/<partial>` that ends at `cursor`, and the
 * skills whose names fit it, those starting with it first, then those containing it, each by name.
 * A bare `/` offers every skill. Undefined when the cursor isn't right after one. `start` and `end`
 * are the text a picked name replaces (`/` included).
 */
export function completeSkillMention(params: {
  text: string;
  cursor: number;
  skills: Skill[];
}): SkillCompletion | undefined {
  const { text, cursor, skills } = params;
  const typed = new RegExp(String.raw`${MENTION_BEFORE}\/([a-z0-9-]*)$`).exec(
    text.slice(0, cursor),
  );

  if (!typed) return undefined;

  const query = typed[1] ?? '';
  const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name);
  const starting = skills.filter((skill) => skill.name.startsWith(query)).sort(byName);
  const containing = skills
    .filter((skill) => !skill.name.startsWith(query) && skill.name.includes(query))
    .sort(byName);

  return { query, start: typed.index, end: cursor, matches: [...starting, ...containing] };
}

/**
 * The message a user's text sends when it mentions skills: each skill's instructions, then the
 * text as the user typed it. Files a skill links to are read with read_skill, from its folder.
 */
export function formatSkillRequest(params: {
  skills: { skill: Skill; body: string }[];
  text: string;
}): string {
  const { skills, text } = params;
  const names = skills.map(({ skill }) => skill.name);
  const sections = skills.map(({ skill, body }) => `## Skill: ${skill.name}\n\n${body}`);
  const intro =
    `The user's message below runs ${names.length === 1 ? 'this skill' : 'these skills'} ` +
    `(${names.map((name) => `/${name}`).join(', ')}). Follow ${names.length === 1 ? 'its' : 'their'} ` +
    "instructions; read the files they link to with read_skill (the skill's name, and the file " +
    'relative to its folder).';

  return `${intro}\n\n${sections.join('\n\n')}\n\n---\n\n${text}`;
}
