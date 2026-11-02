// The layout check (`npm run layout`, part of `npm run check`): the files on disk follow the
// workspace layout in packages/eslint-config/src/layout.js. Every workspace:
//
// - has a layout entry at its directory, and is named `@sheavly/<folder>` (the app being split,
//   listed with `layers`, keeps its name until #29);
// - has an `eslint.config.js` calling `baseConfig`, a `tsconfig.json` extending
//   `tsconfig.base.json` with `rootDir: "src"`, and a `knip.json` entry;
// - depends (`dependencies`) on exactly the @sheavly/* workspaces its `dependsOn` lists, and on
//   others only as dev dependencies, and only on tooling or test-only ones.
//
// And TypeScript lives only in a workspace's `src/`, apart from what `NOT_SOURCE` lists and why.
//
//   node scripts/check-layout.mjs   prints each problem and exits 1, or exits 0
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { LAYOUT, NOT_SOURCE } from '../packages/eslint-config/src/layout.js';
import { listWorkspaces } from '../packages/eslint-config/src/layout.utils.js';

const SCOPE = '@sheavly/';
const TYPESCRIPT = /\.[cm]?tsx?$/;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A tsconfig (JSON with comments), or null when it isn't there. */
function readTsconfig(file) {
  if (!existsSync(file)) return null;

  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));

  if (error) return { unreadable: ts.flattenDiagnosticMessageText(error.messageText, '\n') };

  return config;
}

function nameProblems(params) {
  const { workspace, entry } = params;

  if (!entry) {
    return [
      `${workspace.relative}: ${workspace.name} has no entry in packages/eslint-config/src/layout.js; add its kind, domain and dependsOn.`,
    ];
  }

  const problems = [];

  if (entry.dir !== workspace.relative) {
    problems.push(`${workspace.relative}: the layout puts ${workspace.name} at ${entry.dir}.`);
  }

  const folder = path.basename(workspace.dir);

  if (!entry.layers && workspace.name !== `${SCOPE}${folder}`) {
    problems.push(
      `${workspace.relative}: name it ${SCOPE}${folder}, after its folder (it is ${workspace.name}).`,
    );
  }

  return problems;
}

function configProblems(params) {
  const { workspace, knip } = params;
  const at = (file) => path.join(workspace.dir, file);
  const problems = [];
  const eslintConfig = at('eslint.config.js');

  if (!existsSync(eslintConfig) || !readFileSync(eslintConfig, 'utf8').includes('baseConfig(')) {
    problems.push(
      `${workspace.relative}: eslint.config.js must call baseConfig({ tsconfigRootDir: import.meta.dirname }) from @sheavly/eslint-config.`,
    );
  }

  const tsconfig = readTsconfig(at('tsconfig.json'));

  if (!tsconfig || tsconfig.unreadable) {
    problems.push(
      `${workspace.relative}: tsconfig.json is missing or unreadable${tsconfig ? `: ${tsconfig.unreadable}` : ''}.`,
    );
  } else {
    if (!String(tsconfig.extends ?? '').endsWith('tsconfig.base.json')) {
      problems.push(
        `${workspace.relative}: tsconfig.json must extend the root tsconfig.base.json.`,
      );
    }

    if (tsconfig.compilerOptions?.rootDir !== 'src') {
      problems.push(
        `${workspace.relative}: tsconfig.json must set "rootDir": "src", so an import from outside the workspace is a type error.`,
      );
    }
  }

  if (!(workspace.relative in (knip.workspaces ?? {}))) {
    problems.push(`${workspace.relative}: add it to knip.json's "workspaces".`);
  }

  return problems;
}

function dependencyProblems(params) {
  const { workspace, entry, layout } = params;
  const manifest = readJson(path.join(workspace.dir, 'package.json'));
  const ours = (deps) => Object.keys(deps ?? {}).filter((name) => name.startsWith(SCOPE));
  const runtime = ours(manifest.dependencies);
  const dev = ours(manifest.devDependencies);
  const problems = [];

  for (const name of runtime.filter((dep) => !entry.dependsOn.includes(dep))) {
    problems.push(
      `${workspace.relative}: depends on ${name}, which its layout entry's dependsOn doesn't list.`,
    );
  }

  for (const name of entry.dependsOn.filter((dep) => !runtime.includes(dep))) {
    problems.push(
      `${workspace.relative}: its layout entry lists ${name}, but package.json doesn't depend on it (\`npm install ${name}@0.0.0 -w ${workspace.relative}\`).`,
    );
  }

  for (const name of dev.filter(
    (dep) => layout[dep]?.domain !== 'tooling' && !layout[dep]?.testOnly,
  )) {
    problems.push(
      `${workspace.relative}: ${name} is a dev dependency, but only tooling and test-only workspaces may be.`,
    );
  }

  return problems;
}

/**
 * `file` matches `glob`. A trailing `/**` takes everything below, dot folders included
 * (`path.matchesGlob` skips those, and a fixture's `.sheavly/` is still not harness source).
 */
function matchesPath(params) {
  const { file, glob } = params;

  return glob.endsWith('/**') ? file.startsWith(glob.slice(0, -2)) : path.matchesGlob(file, glob);
}

/** TypeScript files outside every workspace's `src/`, apart from what `NOT_SOURCE` lists. */
function strayProblems(params) {
  const { workspaces, files, notSource } = params;
  const sources = workspaces.map(({ relative }) =>
    relative === '.' ? 'src/' : `${relative}/src/`,
  );

  return files
    .filter((file) => TYPESCRIPT.test(file))
    .filter((file) => !sources.some((src) => file.startsWith(src)))
    .filter((file) => !Object.keys(notSource).some((glob) => matchesPath({ file, glob })))
    .map(
      (file) =>
        `${file}: source lives in a workspace's src/. Move it, or list why it isn't source in NOT_SOURCE (packages/eslint-config/src/layout.js).`,
    );
}

/** Every layout problem in the repo at `root`, given its tracked and untracked `files`. */
export function findLayoutProblems(params) {
  const { root, files, layout = LAYOUT, notSource = NOT_SOURCE } = params;
  const workspaces = listWorkspaces(root);
  const knip = existsSync(path.join(root, 'knip.json'))
    ? readJson(path.join(root, 'knip.json'))
    : {};

  return [
    ...workspaces.flatMap((workspace) => {
      const entry = layout[workspace.name];
      const named = nameProblems({ workspace, entry });

      if (!entry) return named;

      return [
        ...named,
        ...configProblems({ workspace, knip }),
        ...dependencyProblems({ workspace, entry, layout }),
      ];
    }),
    ...strayProblems({ workspaces, files, notSource }),
  ];
}

function listRepoFiles(root) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);

  return result.stdout.split('\n').filter(Boolean);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..');
  const problems = findLayoutProblems({ root, files: listRepoFiles(root) });

  for (const problem of problems) console.error(problem);

  process.exit(problems.length === 0 ? 0 : 1);
}
