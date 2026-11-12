// The skills' guides hold together: a router skill (one whose `harness.json` has `guides`) is the
// only way to reach its guides, so each one is in the router's table and in `guides` (the hook
// names it when a file it covers is edited), and each glob there matches a file. Every workspace's
// source is covered by some guide, read from the workspaces, so a new package is covered by being
// created and an uncovered one fails here. The metadata is read by the one shared reader
// (`packages/eslint-config/src/skills.js`); a mapped rule that does not exist fails when the lint
// plugin loads it (`skill-pointers.js`). What a guide says is review's judgement, not checked.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { listWorkspaces } from '../packages/eslint-config/src/layout.utils.js';
import { findGoverningGuides, listSkills } from '../packages/eslint-config/src/skills.js';

const GUIDE = /\.md$/;
const ROUTER = 'SKILL.md';

function linkedFrom(params) {
  const { root, skill, guide } = params;
  const router = readFileSync(path.join(root, skill.skillFile), 'utf8');

  return router.includes(`](${guide})`);
}

function guideFiles(params) {
  const { root, skill } = params;

  return readdirSync(path.join(root, skill.dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && GUIDE.test(entry.name) && entry.name !== ROUTER)
    .map((entry) => entry.name);
}

/** A router's guides that nothing leads to: not in `guides`, or not linked from its SKILL.md. */
function unreachableProblems(params) {
  const { root, skill } = params;

  return guideFiles({ root, skill }).flatMap((guide) => {
    const where = `${skill.dir}/${guide}`;

    return [
      ...(guide in skill.guides
        ? []
        : [
            `${where}: no \`guides\` entry in ${skill.dir}/harness.json, so the post-edit hook never names it. Add one with the globs it covers.`,
          ]),
      ...(linkedFrom({ root, skill, guide })
        ? []
        : [`${where}: ${skill.skillFile} does not link it, so nobody is led to it. Add a row.`]),
    ];
  });
}

/** A `guides` glob that matches no file: a stale one covers nothing. */
function staleProblems(params) {
  const { skill, files } = params;

  return Object.entries(skill.guides).flatMap(([guide, globs]) =>
    globs
      .filter((glob) => !files.some((file) => path.posix.matchesGlob(file, glob)))
      .map(
        (glob) =>
          `${skill.dir}/harness.json: \`guides\` \`${guide}\` glob \`${glob}\` matches no file.`,
      ),
  );
}

/** A workspace whose source no guide covers: its code would be edited without one named. */
function uncoveredProblems(params) {
  const { root, skills } = params;
  const routers = skills.filter(({ guides }) => Object.keys(guides).length > 0);

  if (routers.length === 0) return [];

  return listWorkspaces(root).flatMap(({ relative }) => {
    const sample = `${relative}/src/sample/sample.helper.ts`;
    const covered = findGoverningGuides({ root, relative: sample }).some(({ guide }) => guide);

    return covered
      ? []
      : [
          `${relative}: no guide covers its source. Add its path to a guide's globs in the router's harness.json (a pattern like \`packages/*/src/**\` covers a new workspace by itself).`,
        ];
  });
}

const HOOK_HANDLERS_FILE = 'packages/core/src/hook/hook.constants.ts';

/**
 * The handler names in the `HANDLERS` object (a `name: true,` entry each): `names`, or a
 * `problem` when the file exists but the object cannot be read, so moving it fails this check
 * instead of silently turning it off. A repo without the file has no handlers to check.
 */
function hookHandlers(root) {
  const file = path.join(root, HOOK_HANDLERS_FILE);

  if (!existsSync(file)) return { names: [] };

  // From the declaration to the first line that starts with `}`: entries are one per line, so a
  // `}` inside a trailing comment cannot end the block early.
  const block = /export const HANDLERS = \{\n([\s\S]*?)\n\}/.exec(readFileSync(file, 'utf8'))?.[1];
  const lines = (block ?? '').split('\n').filter((line) => line.trim() !== '');
  const names = lines.flatMap((line) => /^\s+(\w+): true,\s*(\/\/.*)?$/.exec(line)?.[1] ?? []);

  // Every line must be an entry: a partly read block would leave handlers unchecked unnoticed.
  if (names.length === 0 || names.length !== lines.length) {
    return {
      names,
      problem: `${HOOK_HANDLERS_FILE}: could not read every entry of the HANDLERS object (one \`name: true,\` per line, an optional // comment after), so hook handlers are not checked against the guides. Update scripts/skill-guides.mjs with the file.`,
    };
  }

  return { names };
}

/** The text of every guide of the routers, so a name can be looked for in all of them. */
function guideText(params) {
  const { root, routers } = params;

  return routers
    .flatMap((skill) => Object.keys(skill.guides).map((guide) => `${skill.dir}/${guide}`))
    .map((file) => readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
}

/**
 * What the code has that a guide must know about, read from the code: a `harness/*` rule
 * (`ruleNames`) no router maps to a guide, and a hook handler no guide names. A new rule or hook
 * point fails here until its guide says something about it.
 */
function completenessProblems(params) {
  const { root, routers, ruleNames } = params;

  if (routers.length === 0) return [];

  const mapped = new Set(routers.flatMap((skill) => skill.lintRules));
  const text = guideText({ root, routers });
  const handlers = hookHandlers(root);

  return [
    ...(handlers.problem ? [handlers.problem] : []),
    ...ruleNames
      .filter((name) => !mapped.has(`harness/${name}`))
      .map(
        (name) =>
          `harness/${name}: no skill maps this rule to a guide. Add it to \`lintRules\` and \`ruleFiles\` in the router's harness.json, and say in that guide what it enforces and what stays review-only.`,
      ),
    ...handlers.names
      .filter((handler) => !text.includes(`\`${handler}\``))
      .map(
        (handler) =>
          `hook handler \`${handler}\` (${HOOK_HANDLERS_FILE}): no skill guide names it in backticks. Describe when it runs and what it may return in the guide for adding a hook.`,
      ),
  ];
}

/**
 * Every skill-guide problem in the repo at `root`, given its tracked and untracked `files` and the
 * lint plugin's rule names (without the `harness/` prefix; none skips the rule check).
 */
export function skillGuideProblems(params) {
  const { root, files, ruleNames = [] } = params;

  if (!existsSync(path.join(root, '.agents/skills'))) return [];

  const skills = listSkills(root);
  const routers = skills.filter(({ guides }) => Object.keys(guides).length > 0);

  return [
    ...routers.flatMap((skill) => unreachableProblems({ root, skill })),
    ...routers.flatMap((skill) => staleProblems({ skill, files })),
    ...uncoveredProblems({ root, skills }),
    ...completenessProblems({ root, routers, ruleNames }),
  ];
}
