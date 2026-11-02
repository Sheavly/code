// Lint and the hooks enforce the mechanics; the skills hold the judgement. Each skill says where
// it applies in a `harness.json` beside its SKILL.md, so a new skill is wired into the post-edit
// hook by its own metadata, never by a list here:
//   governs  repo-relative globs of the files it governs: editing one names the skill, once per
//            skill per chat, so the judgement arrives before the code does
//   manual   why it governs no file (invoked by hand, like `/git`); required when governs is empty
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ProjectReadError } from './hooks.errors.mjs';
import { getChatState, PROJECT_ROOT, updateChatState } from './hooks.utils.mjs';

export const SKILLS_DIR = '.cursor/skills';
export const SKILL_METADATA_FILE = 'harness.json';

const isGlobList = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');

/** What is wrong with a skill's metadata; [] when it is valid. A misspelt key is never ignored. */
export function metadataProblems(metadata) {
  const known = new Set(['governs', 'manual']);
  const unknown = Object.keys(metadata)
    .filter((key) => !known.has(key))
    .map((key) => `unknown key \`${key}\``);
  const problems = [...unknown];

  if (!isGlobList(metadata.governs)) problems.push('`governs` must be a list of globs');

  if (
    metadata.manual !== undefined &&
    !(typeof metadata.manual === 'string' && metadata.manual.trim())
  ) {
    problems.push('`manual` must be a reason');
  }

  if (metadata.governs?.length === 0 && metadata.manual === undefined) {
    problems.push('an empty `governs` needs a `manual` reason');
  }

  return problems;
}

function readSkill(params) {
  const { root, name } = params;
  const dir = path.posix.join(SKILLS_DIR, name);
  const metadataFile = path.posix.join(dir, SKILL_METADATA_FILE);
  const missing = ['SKILL.md', SKILL_METADATA_FILE].filter(
    (file) => !existsSync(path.join(root, dir, file)),
  );

  if (missing.length > 0) {
    throw new ProjectReadError({
      file: dir,
      cause: `it has no ${missing.join(' or ')}; every skill needs a SKILL.md and a ${SKILL_METADATA_FILE} saying which files it governs (.cursor/hooks/skills.utils.mjs)`,
    });
  }

  let metadata;

  try {
    metadata = JSON.parse(readFileSync(path.join(root, metadataFile), 'utf8'));
  } catch (caughtError) {
    throw new ProjectReadError({ file: metadataFile, cause: caughtError });
  }

  const problems = metadataProblems(metadata);

  if (problems.length > 0) {
    throw new ProjectReadError({ file: metadataFile, cause: `${problems.join('; ')}.` });
  }

  return { name, skillFile: path.posix.join(dir, 'SKILL.md'), ...metadata };
}

/** Every skill in `.cursor/skills/`, with its metadata. Throws on one it can't read. */
export function listSkills(root = PROJECT_ROOT) {
  const skillsDir = path.join(root, SKILLS_DIR);

  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkill({ root, name: entry.name }));
}

/** The skills whose `governs` globs match `relative` (a `/`-separated path from the root). */
export function findGoverningSkills(params) {
  const { root = PROJECT_ROOT, relative } = params;

  return listSkills(root).filter(({ governs }) =>
    governs.some((glob) => path.matchesGlob(relative, glob)),
  );
}

/** One line per skill governing `relative` that this chat hasn't been shown yet; records them. */
export function hintGoverningSkills(params) {
  const { conversationId, relative, root = PROJECT_ROOT } = params;
  const shown = new Set(getChatState(conversationId)?.skillHintsShown ?? []);
  const skills = findGoverningSkills({ root, relative }).filter(({ name }) => !shown.has(name));

  if (skills.length === 0) return [];

  updateChatState({
    conversationId,
    skillHintsShown: [...shown, ...skills.map(({ name }) => name)],
  });

  return skills.map(
    ({ name, skillFile }) =>
      `Skill: ${relative} is governed by the \`${name}\` skill. If you haven't this chat, read ${skillFile} before going further; lint checks the mechanics, the skill holds the judgement.`,
  );
}
