import type { SendPromptRequest } from '@sheavly/protocol/server/server.types';
import { readGuardedFile } from '../files/guarded-read.helper.js';
import { SKILL_FILE } from './skills.constants.js';
import { findSkills } from './skills.helper.js';
import type { Skill, SkillFile, SkillRequest, SkillRoots } from './skills.types.js';
import {
  findSkillMentions,
  formatSkillRequest,
  partsOf,
  skillBody,
  skillNamesOf,
  textOf,
} from './skills.utils.js';
import { UnknownSkillError } from '../errors/skills.errors.js';

/**
 * A file in `skill`'s folder, which must be inside it (symlinks followed); missing is ENOENT. A
 * `.env` file, or a link to one, is refused.
 */
async function readFromSkill(params: {
  skill: Skill;
  file: string;
  signal?: AbortSignal | undefined;
}): Promise<SkillFile> {
  const { skill, file, signal } = params;
  const found = await readGuardedFile({ dir: skill.dir, file, signal });

  return { skill, ...found };
}

/**
 * A file of the skill called `name` (any skill, `disable-model-invocation` ones too): its SKILL.md,
 * or `file` relative to its folder. Undefined when no skill has that name. The file must be inside
 * the skill's folder, symlinks followed, as files are inside a workspace; a missing one is ENOENT.
 * A `.env` file, or a link to one, is refused with a `ToolCallError`, as `read_skill` does.
 */
export async function readSkillFile(
  params: SkillRoots & { name: string; file?: string | undefined; signal?: AbortSignal },
): Promise<SkillFile | undefined> {
  const { name, file = SKILL_FILE, signal, ...roots } = params;
  const { skills } = await findSkills({ ...roots, ...(signal && { signal }) });
  const skill = skills.find((candidate) => candidate.name === name);

  return skill && readFromSkill({ skill, file, signal });
}

/**
 * What a user's prompt sends, for a UI that runs skills. From `text`, the skills its `/<name>`
 * mentions name (unknown ones stay text, listed in `unknown`); from `parts`, exactly the skills
 * picked (an unknown one throws `UnknownSkillError`: the UI's list is stale). With skills, the
 * message is their instructions, then what the user typed, and `parts` keeps what they typed for
 * a UI; without, the text unchanged. It runs `disable-model-invocation` skills too: the user
 * asked for them.
 */
export async function skillRequest(
  params: SkillRoots & { prompt: SendPromptRequest; signal?: AbortSignal },
): Promise<SkillRequest> {
  const { prompt, signal, ...roots } = params;
  const wanted =
    'parts' in prompt
      ? skillNamesOf(prompt.parts)
      : [...new Set(findSkillMentions(prompt.text).map(({ name }) => name))];
  const typed = 'parts' in prompt ? textOf(prompt.parts) : prompt.text;

  if (wanted.length === 0) return { text: typed, skills: [], unknown: [] };

  const { skills } = await findSkills({ ...roots, ...(signal && { signal }) });
  const used = wanted.flatMap((name) => skills.filter((skill) => skill.name === name));
  const unknown = wanted.filter((name) => !used.some((skill) => skill.name === name));

  if ('parts' in prompt && unknown.length > 0) throw new UnknownSkillError({ skills: unknown });
  if (used.length === 0) return { text: typed, skills: [], unknown };

  const files = await Promise.all(
    used.map((skill) => readFromSkill({ skill, file: SKILL_FILE, signal })),
  );
  const parts =
    'parts' in prompt
      ? prompt.parts
      : partsOf({ text: prompt.text, known: new Set(used.map(({ name }) => name)) });

  return {
    text: formatSkillRequest({
      skills: files.map((found) => ({ skill: found.skill, body: skillBody(found.text) })),
      text: typed,
    }),
    parts,
    skills: used.map((skill) => skill.name),
    unknown,
  };
}
