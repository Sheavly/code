// The layout check (`npm run layout`, part of `npm run check`): the workspaces on disk hold
// together as the layout reads them (packages/eslint-config/src/layout.utils.js): each has a
// domain, is named `@sheavly/<folder>`, and depends on no app, and a generic one on no coding one.
// Every workspace also has an `eslint.config.js` calling `baseConfig`, a `tsconfig.json`
// extending `tsconfig.base.json` with `rootDir: "src"`, a `tsconfig.build.json` referencing
// exactly the workspaces it depends on, and source of its own. And TypeScript
// lives only in a workspace's `src/`, apart from what `NOT_SOURCE` lists and why. The workspace
// graph in docs/overview.md is the one drawn from the workspaces (`graph.mjs`), and no other doc
// draws its own; nothing names the root `src/` from before the split, and code names no issue
// (`stale-references.mjs`). Lint runs the same checks on each workspace's files; this one also covers a
// workspace with no source.
//
//   node scripts/check-layout.mjs   prints each problem and exits 1, or exits 0
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { copiedGraphProblems, graphProblem } from './graph.mjs';
import { staleReferenceProblems } from './stale-references.mjs';
import { NOT_SOURCE } from '../packages/eslint-config/src/layout.js';
import {
  TESTING_EXPORT,
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

/** Whether the workspace at `dir` (relative to the root) has source files of its own. */
function hasSource(params) {
  const { files, dir } = params;
  const src = `${dir.split(path.sep).join('/')}/src/`;

  return files.some((file) => file.startsWith(src) && /\.[cm]?[jt]s$/.test(file));
}

/**
 * `tsc -b` builds a workspace after the ones its `tsconfig.build.json` references, so those are
 * exactly its runtime dependencies on other workspaces (`dependsOn`), as the scaffold writes them.
 * A missing one builds against a stale `dist/`; an extra one is a dependency nobody declared. A
 * workspace with no source yet is skipped: the scaffold references its planned dependencies, and
 * installs each with its first import.
 */
function referenceProblems(params) {
  const { root, layout, files } = params;

  return Object.entries(layout).flatMap(([name, entry]) => {
    const config = readTsconfig(path.join(root, entry.dir, 'tsconfig.build.json'));

    if (!config || config.unreadable || !hasSource({ files, dir: entry.dir })) return [];

    const referenced = (config.references ?? []).map(({ path: ref }) =>
      path.posix.normalize(path.posix.join(entry.dir, path.posix.dirname(ref))),
    );
    const wanted = entry.dependsOn.map((dep) => layout[dep].dir);
    const missing = wanted.filter((dir) => !referenced.includes(dir));
    const extra = referenced.filter((dir) => !wanted.includes(dir));

    return [
      ...missing.map(
        (dir) =>
          `${entry.dir}/tsconfig.build.json: add a reference to ${dir}, which ${name} depends on, so tsc -b builds it first.`,
      ),
      ...extra.map(
        (dir) =>
          `${entry.dir}/tsconfig.build.json: drop the reference to ${dir}: ${name} doesn't depend on it at runtime (add it to dependencies if its source imports it).`,
      ),
    ];
  });
}

/** TypeScript files outside every workspace's `src/`, apart from what `NOT_SOURCE` lists. */
function strayProblems(params) {
  const { workspaces, files, notSource } = params;

  return files
    .filter((file) => isStraySource({ workspaces, file, notSource }))
    .map((file) => `${file}: ${STRAY_SOURCE}`);
}

/**
 * A package's public API is what its `exports` lists, one module file per subpath, each with the
 * source, types and build targets; never a wildcard over its whole `src/` (only its fakes,
 * `./testing/*`, from source). An app exports nothing: nothing imports it.
 */
function exportsProblems(params) {
  const { workspace, kind } = params;
  const exportsField = workspace.manifest.exports;
  const where = `${workspace.relative}: package.json exports`;

  if (kind === 'app') {
    return exportsField ? [`${where} something, but nothing imports an app; remove it.`] : [];
  }

  if (workspace.manifest.sheavly?.domain === 'tooling') return [];

  if (!exportsField || typeof exportsField !== 'object') {
    return [
      `${workspace.relative}: package.json has no exports, so every file is public. List its public modules: \`npm run export -- ${workspace.manifest.name}/<module>/<file>\` (or \`npm pkg set exports={} --json\` while it has none).`,
    ];
  }

  return Object.entries(exportsField).flatMap(([subpath, targets]) => {
    if (subpath === TESTING_EXPORT) {
      return targets?.['@sheavly/source'] === './src/testing/*.ts'
        ? []
        : [
            `${where} ${subpath} must point at its source only: { "@sheavly/source": "./src/testing/*.ts" }.`,
          ];
    }

    if (subpath.includes('*')) {
      return [
        `${where} ${subpath}, a wildcard: every file would be public. List the modules other workspaces may import, one subpath each.`,
      ];
    }

    const file = subpath.slice(2);
    const expected = {
      '@sheavly/source': `./src/${file}.ts`,
      types: `./dist/${file}.d.ts`,
      default: `./dist/${file}.js`,
    };

    if (JSON.stringify(targets) !== JSON.stringify(expected)) {
      return [`${where} ${subpath} must be ${JSON.stringify(expected)}.`];
    }

    return existsSync(path.join(workspace.dir, expected['@sheavly/source']))
      ? []
      : [
          `${where} ${subpath}, but ${expected['@sheavly/source']} doesn't exist; remove the entry.`,
        ];
  });
}

/**
 * Which backend a run uses is the UI's choice: a package takes a `Provider` and never depends at
 * runtime on one that holds model backends (`*.adapter.ts` files, read from the files). Tests may
 * use them as dev dependencies, to drive the real code.
 */
function providerProblems(params) {
  const { root, workspaces, layout, files } = params;
  const relativeOf = (workspace) => path.relative(root, workspace.dir).split(path.sep).join('/');
  const backends = new Set(
    workspaces
      .filter((workspace) =>
        files.some(
          (file) =>
            file.startsWith(`${relativeOf(workspace)}/src/`) && file.endsWith('.adapter.ts'),
        ),
      )
      .map(({ name }) => name),
  );

  return Object.entries(layout)
    .filter(([, entry]) => entry.kind === 'package')
    .flatMap(([name, entry]) =>
      entry.dependsOn
        .filter((dependency) => backends.has(dependency))
        .map(
          (dependency) =>
            `${name} depends on ${dependency}, which holds the model backends: which backend a run uses is the UI's choice. Take a Provider as an option, and let the app build it (make it a dev dependency if only tests need it).`,
        ),
    );
}

/** A workspace with no source of its own: nothing to typecheck, test or import yet. */
function emptyProblems(params) {
  const { root, workspaces, files } = params;

  return workspaces
    .filter((workspace) => !hasSource({ files, dir: path.relative(root, workspace.dir) }))
    .map(
      (workspace) =>
        `${workspace.relative}: has no source yet. Add its first module, ${workspace.relative}/src/<module>/<module>.<kind>.ts, with its tests in <module>/__tests__/; a workspace with nothing in it is dead weight.`,
    );
}

/** Every layout problem in the repo at `root`, given its tracked and untracked `files`. */
export function findLayoutProblems(params) {
  const { root, files, notSource = NOT_SOURCE } = params;
  const workspaces = listWorkspaces(root);
  const layout = readLayout({ root });

  return [
    ...layoutProblems(layout).map((problem) => `${problem}.`),
    ...workspaces.flatMap((workspace) => configProblems({ workspace })),
    ...workspaces.flatMap((workspace) =>
      exportsProblems({ workspace, kind: layout[workspace.name]?.kind }),
    ),
    ...referenceProblems({ root, layout, files }),
    ...emptyProblems({ root, workspaces, files }),
    ...providerProblems({ root, workspaces, layout, files }),
    ...strayProblems({ workspaces, files, notSource }),
  ];
}

/**
 * The repo's own words: the generated graph is current, nothing else draws one, and nothing
 * names the layout before the split or promises what an issue will do.
 */
export function findGraphProblems(params) {
  const { root, files } = params;

  return [
    graphProblem(root),
    ...copiedGraphProblems({ root, files }),
    ...staleReferenceProblems({ root, files }),
  ].filter(Boolean);
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
