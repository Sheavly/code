import { readFile } from 'node:fs/promises';
import { SKILL_FILE } from './skills.constants.js';
import { findSkills } from './skills.helper.js';
import type { Skill, SkillFile, SkillRequest, SkillRoots } from './skills.types.js';
import { findSkillMentions, formatSkillRequest, skillBody } from './skills.utils.js';
import { Workspace } from '../workspace/workspace.service.js';

/** A file in `skill`'s folder, which must be inside it (symlinks followed); missing is ENOENT. */
async function readFromSkill(params: {
  skill: Skill;
  file: string;
  signal?: AbortSignal | undefined;
}): Promise<SkillFile> {
  const { skill, file, signal } = params;
  const folder = await Workspace.open(skill.dir);
  const real = await folder.resolveRead(file);
  const text = await readFile(real, { encoding: 'utf8', ...(signal && { signal }) });

  return { skill, path: real, text };
}

/**
 * A file of the skill called `name` (any skill, `disable-model-invocation` ones too): its SKILL.md,
 * or `file` relative to its folder. Undefined when no skill has that name. The file must be inside
 * the skill's folder, symlinks followed, as files are inside a workspace; a missing one is ENOENT.
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
 * What a user's message sends, for a UI that runs skills: when it mentions skills (`/<name>` anywhere in it),
 * their instructions, then the text as typed; otherwise the text unchanged. `skills` names the
 * skills it ran, `unknown` the mentions no skill has. It runs `disable-model-invocation` skills
 * too: the user asked for them.
 */
export async function skillRequest(
  params: SkillRoots & { text: string; signal?: AbortSignal },
): Promise<SkillRequest> {
  const { text, signal, ...roots } = params;
  const mentions = [...new Set(findSkillMentions(text).map(({ name }) => name))];

  if (mentions.length === 0) return { text, skills: [], unknown: [] };

  const { skills } = await findSkills({ ...roots, ...(signal && { signal }) });
  const used = mentions.flatMap((name) => skills.filter((skill) => skill.name === name));
  const unknown = mentions.filter((name) => !used.some((skill) => skill.name === name));

  if (used.length === 0) return { text, skills: [], unknown };

  const files = await Promise.all(
    used.map((skill) => readFromSkill({ skill, file: SKILL_FILE, signal })),
  );

  return {
    text: formatSkillRequest({
      skills: files.map((found) => ({ skill: found.skill, body: skillBody(found.text) })),
      text,
    }),
    skills: used.map((skill) => skill.name),
    unknown,
  };
}
