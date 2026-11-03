// The layout check (`npm run layout`, part of `npm run check`): the workspaces on disk hold
// together as the layout reads them (packages/eslint-config/src/layout.utils.js): each has a
// domain, is named `@sheavly/<folder>`, and depends on no app, and a generic one on no coding one.
// Every workspace also has an `eslint.config.js` calling `baseConfig`, a `tsconfig.json`
// extending `tsconfig.base.json` with `rootDir: "src"`, and source of its own. And TypeScript
// lives only in a workspace's `src/`, apart from what `NOT_SOURCE` lists and why. The workspace
// graph in docs/overview.md is the one drawn from the workspaces (`graph.mjs`), and no other doc
// draws its own. Lint runs the same checks on each workspace's files; this one also covers a
// workspace with no source.
//
//   node scripts/check-layout.mjs   prints each problem and exits 1, or exits 0
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { copiedGraphProblems, graphProblem } from './graph.mjs';
import { NOT_SOURCE } from '../packages/eslint-config/src/layout.js';
import {
  isStraySource,
  layoutProblems,
  listWorkspaces,
  readLayout,
  STRAY_SOURCE,
} from '../packages/eslint-config/src/layout.utils.js';

/** A tsconfig (JSON with comments), or null when it isn't there. */
function readTsconfig(file) {
  if (!existsSync(file)) return null;

  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));

  if (error) return { unreadable: ts.flattenDiagnosticMessageText(error.messageText, '\n') };

  return config;
}

function configProblems(params) {
  const { workspace } = params;
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

  return problems;
}

/** TypeScript files outside every workspace's `src/`, apart from what `NOT_SOURCE` lists. */
function strayProblems(params) {
  const { workspaces, files, notSource } = params;

  return files
    .filter((file) => isStraySource({ workspaces, file, notSource }))
    .map((file) => `${file}: ${STRAY_SOURCE}`);
}

/** A workspace with no source of its own: nothing to typecheck, test or import yet. */
function emptyProblems(params) {
  const { root, workspaces, files } = params;

  return workspaces
    .filter((workspace) => {
      const src = `${path.relative(root, workspace.dir).split(path.sep).join('/')}/src/`;

      return !files.some((file) => file.startsWith(src) && /\.[cm]?[jt]s$/.test(file));
    })
    .map(
      (workspace) =>
        `${workspace.relative}: has no source yet. Add its first module, ${workspace.relative}/src/<module>/<module>.<kind>.ts, with its tests in <module>/__tests__/; a workspace with nothing in it is dead weight.`,
    );
}

/** Every layout problem in the repo at `root`, given its tracked and untracked `files`. */
export function findLayoutProblems(params) {
  const { root, files, notSource = NOT_SOURCE } = params;
  const workspaces = listWorkspaces(root);

  return [
    ...layoutProblems(readLayout({ root })).map((problem) => `${problem}.`),
    ...workspaces.flatMap((workspace) => configProblems({ workspace })),
    ...emptyProblems({ root, workspaces, files }),
    ...strayProblems({ workspaces, files, notSource }),
  ];
}

/** The repo's own docs: the generated graph is current, and nothing else draws one. */
export function findGraphProblems(params) {
  const { root, files } = params;

  return [graphProblem(root), ...copiedGraphProblems({ root, files })].filter(Boolean);
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
  const files = listRepoFiles(root);
  const problems = [...findLayoutProblems({ root, files }), ...findGraphProblems({ root, files })];

  for (const problem of problems) console.error(problem);

  process.exit(problems.length === 0 ? 0 : 1);
}
