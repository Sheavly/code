import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { SKILL_FILE, SKILLS_FOLDERS } from './skills.constants.js';
import type { FoundSkills, HiddenSkill, Skill, SkillProblem, SkillRoots } from './skills.types.js';
import { formatSkillsInstructions, parseFrontmatter } from './skills.utils.js';
import { skillFrontmatterSchema } from './skills.validator.js';
import { Workspace } from '../workspace/workspace.service.js';
import { appendInstructionContext } from '../instruction-context/instruction-context.helper.js';

/**
 * A skill file or folder that couldn't be read (no permission, a SKILL.md that is a folder or
 * points out of its skill's folder): a problem to report, so the other skills still load. A
 * stopped run's abort is rethrown, never reported.
 */
function unreadable(params: {
  path: string;
  caughtError: unknown;
  signal?: AbortSignal | undefined;
}): SkillProblem {
  const { path: file, caughtError, signal } = params;

  if (signal?.aborted) throw caughtError;

  const message = caughtError instanceof Error ? caughtError.message : String(caughtError);

  return { path: file, reason: `it can't be read: ${message}` };
}

/** The skill in `dir`, or why it didn't load. */
async function readSkill(params: {
  dir: string;
  scope: Skill['scope'];
  signal?: AbortSignal | undefined;
}): Promise<Skill | SkillProblem | undefined> {
  const { dir, scope, signal } = params;
  const file = path.join(dir, SKILL_FILE);
  let text: string;

  try {
    // Through the skill's folder as a Workspace: a SKILL.md that is a symlink out of it is refused.
    const real = await (await Workspace.open(dir)).resolveRead(SKILL_FILE);

    text = await readFile(real, { encoding: 'utf8', ...(signal && { signal }) });
  } catch (caughtError) {
    // A folder without a SKILL.md is not a skill (a shared assets folder, say).
    if (isMissingPath(caughtError)) return undefined;

    return unreadable({ path: file, caughtError, signal });
  }

  const frontmatter = parseFrontmatter(text);

  if (frontmatter === undefined) return { path: file, reason: 'it has no --- frontmatter' };
  if (typeof frontmatter === 'string') return { path: file, reason: frontmatter };

  const parsed = skillFrontmatterSchema.safeParse(frontmatter);

  if (!parsed.success) {
    return {
      path: file,
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    };
  }

  if (parsed.data.name !== path.basename(dir)) {
    return { path: file, reason: `name "${parsed.data.name}" is not its folder's name` };
  }

  return {
    name: parsed.data.name,
    description: parsed.data.description,
    manualOnly: parsed.data['disable-model-invocation'] === true,
    dir,
    scope,
  };
}

/** The skills in one skills folder, in name order. */
async function readSkillsFolder(params: {
  folder: string;
  scope: Skill['scope'];
  signal?: AbortSignal | undefined;
}): Promise<(Skill | SkillProblem)[]> {
  const { folder, scope, signal } = params;
  let names: string[];

  try {
    const entries = await readdir(folder, { withFileTypes: true });

    // Skill installers often link a skill's folder in: a symlink counts when it points to a
    // folder. One to a file, or a broken one, is not a skill, like any other file.
    const isFolder = async (entry: Dirent) =>
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        (await stat(path.join(folder, entry.name)).then(
          (target) => target.isDirectory(),
          (caughtError: unknown) => {
            if (isMissingPath(caughtError)) return false;
            throw caughtError;
          },
        )));
    const folders = await Promise.all(
      entries.map(async (entry) => ((await isFolder(entry)) ? entry.name : undefined)),
    );

    names = folders.filter((name) => name !== undefined).sort();
  } catch (caughtError) {
    // A skills folder that isn't there (or isn't a folder) holds no skills.
    if (isMissingPath(caughtError)) return [];

    return [unreadable({ path: folder, caughtError, signal })];
  }

  const found = await Promise.all(
    names.map((name) => readSkill({ dir: path.join(folder, name), scope, signal })),
  );

  return found.filter((skill) => skill !== undefined);
}

/**
 * The skills the harness ships (`create-skill`): this package's `skills/` folder, two levels up
 * from `src/skills/` and from `dist/skills/` alike.
 */
const BUILT_IN_SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));

/**
 * Every skill in the project's `.sheavly/skills/` and `.agents/skills/`, the user's
 * `~/.sheavly/skills/`, the built-in ones, then the user's `~/.agents/skills/`. When two share a
 * name, the first in that order wins and the others are `hidden`. The built-in skills come before
 * `~/.agents/skills/` because other agents install their own skills there (Cursor's
 * `create-skill`, say), which mustn't replace this harness's; a `.sheavly/` folder or the project
 * still does. A skill that doesn't load is a problem, never an error, so one broken skill never
 * hides the others.
 */
export async function findSkills(
  params: SkillRoots & { signal?: AbortSignal },
): Promise<FoundSkills> {
  const { root, home, signal } = params;
  const [sheavly, agents] = SKILLS_FOLDERS;
  const user = (parts: readonly string[]) =>
    home === undefined ? [] : [{ folder: path.join(home, ...parts), scope: 'user' as const }];
  const folders = [
    ...SKILLS_FOLDERS.map((parts) => ({
      folder: path.join(root, ...parts),
      scope: 'project' as const,
    })),
    ...user(sheavly),
    { folder: BUILT_IN_SKILLS, scope: 'built-in' as const },
    ...user(agents),
  ];
  const found = (
    await Promise.all(folders.map((folder) => readSkillsFolder({ ...folder, signal })))
  ).flat();
  const skills = new Map<string, Skill>();
  const problems: SkillProblem[] = [];
  const hidden: HiddenSkill[] = [];

  for (const entry of found) {
    const winner = 'name' in entry ? skills.get(entry.name) : undefined;

    if (!('name' in entry)) problems.push(entry);
    else if (winner) hidden.push({ skill: entry, by: winner });
    else skills.set(entry.name, entry);
  }

  return { skills: [...skills.values()], problems, hidden };
}

/**
 * The built-in skills hook: before every turn, lists the skills the model may use (name and
 * description), appending changes to history without rewriting the signed conversation prefix.
 * Bodies are never sent: the model reads one when it fits (`read_skill`).
 */
export function createSkillsHook(options: SkillRoots): Hook {
  const { root, home } = options;

  return defineHook({
    name: 'skills',
    beforeTurn: async (context) => {
      const { skills } = await findSkills({ root, home, signal: context.signal });
      const instructions = formatSkillsInstructions({ skills });

      appendInstructionContext({ context, name: 'skills', instructions });
    },
  });
}
