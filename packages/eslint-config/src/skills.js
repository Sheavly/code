// Lint and the hooks enforce the mechanics; the skills in `.agents/skills/` hold the judgement.
// Each skill says where it applies in a `harness.json` beside its SKILL.md, so a new skill is
// wired into the post-edit hook and the lint messages by its own metadata, never by a list here.
// The one reader for that metadata: the Cursor hooks and the ESLint plugin both import it, so the
// routing is defined once. Plain JavaScript with no dependencies, because the hooks run before
// anything is installed.
//   governs    repo-relative globs of the files it governs: editing one names the skill, so the
//              judgement arrives before the code does
//   lintRules  optional: `harness/*` rules whose messages name it
//   ruleFiles  optional: rule id -> a file beside SKILL.md, so a router skill's message names the
//              guide that holds that rule's judgement instead of only the router
//   guides     optional: guide file beside SKILL.md -> globs it covers, so a router skill names the
//              guide for the file being edited, and each guide is hinted once on its own
//   nudge      optional: guides (names from `guides`) whose files carry knowledge a change must keep
//              current; the stop hook asks once when such a file changed and its guide did not.
//              Leave a broad guide out, or every edit would ask
//   manual     why it governs no file (invoked by hand, like `/git`); required when governs is empty
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SkillMetadataError } from './skills.errors.js';

export const SKILLS_DIR = '.agents/skills';
export const SKILL_METADATA_FILE = 'harness.json';

// Globs run in every edit and stop hook, and a glob whose wildcards are separated by literals
// (`a*a*a*a*a*b`) can take exponential time to match, so a metadata file cannot freeze them: a
// glob is short and has few wildcard groups (a run like `**` is one). Measured on a 300-character
// path: 4 groups match in about 150 ms, 5 groups in about 9 s.
const MAX_GLOB_LENGTH = 200;
const MAX_GLOB_WILDCARDS = 4;
const GUIDE_FILE = /^[\w-][\w.-]*\.md$/;

const isGlob = (item) =>
  typeof item === 'string' &&
  item !== '' &&
  item.length <= MAX_GLOB_LENGTH &&
  (item.match(/\*+/g) ?? []).length <= MAX_GLOB_WILDCARDS;

const isStringList = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '');

const isGlobList = (value) => Array.isArray(value) && value.every(isGlob);

const isStringRecord = (value) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  isStringList(Object.values(value));

const isGlobMap = (value) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(isGlobList);

// An allow-list of keys: a misspelt one would otherwise read as a skill that governs nothing.
const METADATA_CHECKS = {
  governs: {
    required: true,
    isValid: isGlobList,
    expected: `a list of globs (at most ${MAX_GLOB_LENGTH} characters and ${MAX_GLOB_WILDCARDS} wildcards each)`,
  },
  guides: {
    required: false,
    isValid: isGlobMap,
    expected: `an object of guide file name to a list of globs (at most ${MAX_GLOB_LENGTH} characters and ${MAX_GLOB_WILDCARDS} wildcards each)`,
  },
  nudge: { required: false, isValid: isStringList, expected: 'a list of guide file names' },
  lintRules: { required: false, isValid: isStringList, expected: 'a list of rule ids' },
  ruleFiles: {
    required: false,
    isValid: isStringRecord,
    expected: 'an object of rule id to file name',
  },
  manual: {
    required: false,
    isValid: (value) => typeof value === 'string' && value.trim() !== '',
    expected: 'a reason',
  },
};

/** What is wrong with a skill's metadata; [] when it is valid. A misspelt key is never ignored. */
export function metadataProblems(metadata) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return ['it must be a JSON object with `governs` (and `manual` when that is empty)'];
  }

  const unknown = Object.keys(metadata)
    .filter((key) => !Object.hasOwn(METADATA_CHECKS, key))
    .map((key) => `unknown key \`${key}\``);
  const invalid = Object.entries(METADATA_CHECKS)
    .filter(([key, { required }]) => required || Object.hasOwn(metadata, key))
    .filter(([key, { isValid }]) => !isValid(metadata[key]))
    .map(([key, { expected }]) => `\`${key}\` must be ${expected}`);
  const isUnscoped = metadata.governs?.length === 0 && metadata.manual === undefined;

  return [
    ...unknown,
    ...invalid,
    ...(isUnscoped ? ['an empty `governs` needs a `manual` reason'] : []),
  ];
}

/**
 * Whether `file` names a guide of the skill in `dir`: a Markdown file name (no path, no `..`),
 * present beside SKILL.md as a plain file, never a directory or a symlink, so nothing outside the
 * skill's folder is ever read through the metadata.
 */
function isGuideFile(params) {
  const { root, dir, file } = params;

  if (!GUIDE_FILE.test(file)) return false;

  try {
    return lstatSync(path.join(root, dir, file)).isFile();
  } catch (caughtError) {
    // A missing file is the answer (not a guide); anything else is a real read failure.
    if (caughtError.code === 'ENOENT' || caughtError.code === 'ENOTDIR') return false;

    throw caughtError;
  }
}

// A guide sits one level deep beside SKILL.md, and only a rule the skill already names may point
// into it, so a stale entry fails instead of going quiet.
function ruleFileProblems(params) {
  const { root, dir, metadata } = params;

  return Object.entries(metadata.ruleFiles ?? {}).flatMap(([ruleId, file]) => {
    if (!(metadata.lintRules ?? []).includes(ruleId)) {
      return [`\`ruleFiles\` names \`${ruleId}\`, which \`lintRules\` doesn't`];
    }

    if (!isGuideFile({ root, dir, file })) {
      return [
        `\`ruleFiles\` points \`${ruleId}\` to \`${file}\`, which isn't a guide file in ${dir}`,
      ];
    }

    return [];
  });
}

// Same rule as `ruleFiles`: one level deep beside SKILL.md, and present, so a stale guide fails.
function guideFileProblems(params) {
  const { root, dir, metadata } = params;

  const missing = Object.keys(metadata.guides ?? {})
    .filter((file) => !isGuideFile({ root, dir, file }))
    .map((file) => `\`guides\` names \`${file}\`, which isn't a guide file in ${dir}`);
  const unmapped = (metadata.nudge ?? [])
    .filter((file) => !(file in (metadata.guides ?? {})))
    .map((file) => `\`nudge\` names \`${file}\`, which \`guides\` doesn't`);

  return [...missing, ...unmapped];
}

function parseMetadata(params) {
  const { root, metadataFile } = params;

  try {
    return JSON.parse(readFileSync(path.join(root, metadataFile), 'utf8'));
  } catch (caughtError) {
    throw new SkillMetadataError({
      file: metadataFile,
      problem: 'it is not readable JSON',
      cause: caughtError,
    });
  }
}

function readSkill(params) {
  const { root, name } = params;
  const dir = path.posix.join(SKILLS_DIR, name);
  const metadataFile = path.posix.join(dir, SKILL_METADATA_FILE);
  const missing = ['SKILL.md', SKILL_METADATA_FILE].filter(
    (file) => !existsSync(path.join(root, dir, file)),
  );

  if (missing.length > 0) {
    throw new SkillMetadataError({
      file: dir,
      problem: `it has no ${missing.join(' or ')}; every skill needs a SKILL.md and a ${SKILL_METADATA_FILE} saying which files it governs (packages/eslint-config/src/skills.js)`,
    });
  }

  const metadata = parseMetadata({ root, metadataFile });
  const shape = metadataProblems(metadata);
  // `ruleFiles` is read against `lintRules` and the folder only once the shape is valid.
  const problems =
    shape.length > 0
      ? shape
      : [
          ...ruleFileProblems({ root, dir, metadata }),
          ...guideFileProblems({ root, dir, metadata }),
        ];

  if (problems.length > 0) {
    throw new SkillMetadataError({ file: metadataFile, problem: `${problems.join('; ')}.` });
  }

  return {
    name,
    dir,
    skillFile: path.posix.join(dir, 'SKILL.md'),
    lintRules: [],
    ruleFiles: {},
    guides: {},
    nudge: [],
    ...metadata,
  };
}

/** Every skill in `<root>/.agents/skills/`, with its metadata. Throws `SkillMetadataError` on one it can't read. */
export function listSkills(root) {
  const skillsDir = path.join(root, SKILLS_DIR);

  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkill({ root, name: entry.name }));
}

/** The skills whose `governs` globs match `relative` (a `/`-separated path from the root). */
export function findGoverningSkills(params) {
  const { root, relative } = params;

  return listSkills(root).filter(({ governs }) =>
    governs.some((glob) => path.posix.matchesGlob(relative, glob)),
  );
}

/**
 * What to show for editing `relative`: each governing skill, and the guides of it whose globs
 * match the file, as `{ skill, guide }` (`guide` undefined for the skill itself). A guide is its
 * own entry, so showing the router once never hides a narrower guide.
 */
export function findGoverningGuides(params) {
  const { root, relative } = params;

  return findGoverningSkills({ root, relative }).flatMap((skill) => {
    const guides = Object.entries(skill.guides)
      .filter(([, globs]) => globs.some((glob) => path.posix.matchesGlob(relative, glob)))
      .map(([guide]) => ({ skill, guide }));

    return [{ skill, guide: undefined }, ...guides];
  });
}
