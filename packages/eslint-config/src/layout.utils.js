// Reads the workspace layout from the workspaces themselves (see `layout.js` for what comes from
// where): which workspace a file belongs to, and what is wrong with the layout. The rules
// (`rules/layout.js`, `rules/imports.js`), the layout check (`scripts/check-layout.mjs`) and the
// scaffold (`scripts/new-workspace.mjs`) all use it, so they can't disagree.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FILE_KINDS } from './file-kinds.js';
import { NOT_SOURCE } from './layout.js';
import { workspaceDirs } from './rules/workspace-types.js';

/**
 * The options of the rules that read the layout: tests point them at a temp workspace (`root`)
 * or a layout of their own.
 */
export const LAYOUT_RULE_OPTIONS = {
  type: 'object',
  properties: {
    root: { type: 'string' },
    layout: { type: 'object' },
  },
  additionalProperties: false,
};

export const DOMAINS = ['generic', 'coding', 'tooling'];
const SCOPE = '@sheavly/';
const toPosix = (file) => file.split(path.sep).join('/');

/** Every workspace on disk (each `workspaces` match): where it is and its manifest. */
export function listWorkspaces(root) {
  return workspaceDirs(root).map((dir) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));

    return {
      dir,
      relative: toPosix(path.relative(root, dir)) || '.',
      name: manifest.name,
      manifest,
    };
  });
}

/** `packages/*` is a package; `apps/*` (and a root with source) is an app. */
function kindOf(relative) {
  return relative.startsWith('packages/') ? 'package' : 'app';
}

function workspaceDeps(params) {
  const { deps, names } = params;

  return Object.keys(deps ?? {}).filter((name) => names.has(name));
}

/**
 * The layout, by workspace name, derived from the workspaces at `root`: `kind` from the folder,
 * `dependsOn` and `devDependsOn` from the manifest's dependencies on other workspaces, `domain`
 * and `testOnly` from its `sheavly` field.
 */
export function readLayout(params) {
  const { root } = params;
  const workspaces = listWorkspaces(root);
  const names = new Set(workspaces.map(({ name }) => name));

  return Object.fromEntries(
    workspaces.map(({ relative, name, manifest }) => [
      name,
      {
        dir: relative,
        kind: kindOf(relative),
        domain: manifest.sheavly?.domain,
        testOnly: manifest.sheavly?.testOnly === true,
        dependsOn: workspaceDeps({ deps: manifest.dependencies, names }),
        devDependsOn: workspaceDeps({ deps: manifest.devDependencies, names }),
        // The public surface: its package.json `exports`, by file kind (`./*.types`).
        exports: manifest.exports,
      },
    ]),
  );
}

/** The pattern a package exports its fakes by: from source only, for other workspaces' tests. */
const TESTING_EXPORT = './testing/*';

/** The `exports` key that makes every file of `kind` public: `./*.types`. */
export const kindExportKey = (kind) => `./*.${kind}`;

/** What a kind's `exports` entry points at: the source for dev and tests, the build for Node. */
export function kindExportTarget(kind) {
  return { '@sheavly/source': `./src/*.${kind}.ts`, default: `./dist/*.${kind}.js` };
}

const TESTING_TARGET = { '@sheavly/source': './src/testing/*.ts' };

/** Whether `key` (`./*.types`, `./event/event.types`) matches `subpath` (`event/event.types`). */
function keyMatches(params) {
  const { key, subpath } = params;
  const [prefix = '', suffix] = key.split('*');

  return suffix === undefined
    ? key === `./${subpath}`
    : `./${subpath}`.startsWith(prefix) && `./${subpath}`.endsWith(suffix);
}

/** Whether `subpath` (`tool/tool.utils`) is public: some key of the package's `exports` matches. */
export function isExported(params) {
  const { exports, subpath } = params;

  if (!exports || typeof exports !== 'object') return false;

  return Object.keys(exports).some((key) => keyMatches({ key, subpath }));
}

/** The command that exports every file of `kind` from the package at `dir`. */
function exportCommand(params) {
  const { dir, kind } = params;

  return `npm run export -- ${dir} ${kind}`;
}

/** What is wrong with one `exports` entry of a package; null when it is a kind or its fakes. */
function exportEntryProblem(params) {
  const { name, entry, key, target } = params;

  if (key === TESTING_EXPORT) {
    return JSON.stringify(target) === JSON.stringify(TESTING_TARGET)
      ? null
      : `${name} exports ${key}, its fakes, but not from source only: make it ${JSON.stringify(TESTING_TARGET)}`;
  }

  const kind = /^\.\/\*\.([a-z]+)$/.exec(key)?.[1];
  const known = kind && FILE_KINDS.includes(kind) && kind !== 'test';

  if (!known) {
    const fileKind = /\.([a-z]+)$/.exec(key)?.[1] ?? '<kind>';

    return `${name} exports ${key}: a package exports by file kind, never file by file, so a new module needs no entry. Export the kind instead: \`${exportCommand({ dir: entry.dir, kind: fileKind })}\` (\`${kindExportKey(fileKind)}\`)`;
  }

  if (kind === 'fake' && !entry.testOnly) {
    return `${name} exports its fakes as a kind: put them in src/testing/ and export ${TESTING_EXPORT}`;
  }

  return JSON.stringify(target) === JSON.stringify(kindExportTarget(kind))
    ? null
    : `${name} exports ${key} with other targets: make it ${JSON.stringify(kindExportTarget(kind))}`;
}

/**
 * What is wrong with a workspace's public API. A package declares it by file kind: every
 * `<module>.<kind>.ts` of a kind it exports is public (`./*.types`), so a new module needs no
 * entry, and the API widens only when a kind is added, in review. An app exports nothing.
 */
function exportsProblems(params) {
  const { name, entry } = params;
  const { exports } = entry;

  if (entry.kind === 'app') {
    return exports ? [`${name} has exports, but nothing imports an app: remove them`] : [];
  }

  if (entry.domain === 'tooling') return [];

  if (!exports || typeof exports !== 'object') {
    return [
      `${name} has no exports, so every file is public. Export the kinds other workspaces import: \`${exportCommand({ dir: entry.dir, kind: 'types' })}\` (or \`npm pkg set exports={} --json\` while it has none)`,
    ];
  }

  return Object.entries(exports)
    .map(([key, target]) => exportEntryProblem({ name, entry, key, target }))
    .filter(Boolean);
}

/** The workspace `file` belongs to: the deepest workspace dir that holds it. */
export function workspaceOfFile(params) {
  const { workspaces, file } = params;

  return workspaces
    .filter(({ dir }) => file === dir || file.startsWith(`${dir}${path.sep}`))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
}

/** npm's flag for the workspace at `dir`; none for the root, which isn't one of its workspaces. */
export function workspaceFlag(dir) {
  return dir === '.' ? '' : ` -w ${dir}`;
}

/** The command that sets a workspace's domain, for messages that say what to add. */
function domainCommand(dir) {
  return `npm pkg set sheavly.domain=<${DOMAINS.join('|')}>${workspaceFlag(dir)}`;
}

/** Why `name` may not depend on `dependency` at runtime, or null when it may. */
export function edgeProblem(params) {
  const { name, entry, dependency, layout } = params;
  const target = layout[dependency];

  if (!target) return `${name} depends on ${dependency}, which isn't a workspace`;

  if (target.kind === 'app') {
    return `${name} depends on ${dependency}, an app: nothing imports an app`;
  }

  if (entry.domain === 'generic' && target.domain === 'coding') {
    return `${name} is generic but depends on ${dependency}, a coding workspace`;
  }

  if (target.domain === 'tooling' || target.testOnly) {
    return `${name} depends on ${dependency}, which source never imports: make it a dev dependency`;
  }

  return null;
}

function identityProblems(params) {
  const { name, entry } = params;
  const problems = [];

  if (!DOMAINS.includes(entry.domain)) {
    problems.push(`${name} has no domain: run \`${domainCommand(entry.dir)}\``);
  }

  const folder = path.posix.basename(entry.dir);

  // A root with source has no folder of its own to be named after.
  if (entry.dir !== '.' && name !== `${SCOPE}${folder}`) {
    problems.push(`${name} must be named ${SCOPE}${folder}, after its folder`);
  }

  return problems;
}

/** What is wrong with one workspace's entry: its domain, its name and its edges. */
export function entryProblems(params) {
  const { name, entry, layout } = params;
  // A test may use any workspace below it (a real tool to drive the loop with), but never an
  // app, and a generic workspace's tests never a coding one: they must run without a project.
  const devProblems = entry.devDependsOn.flatMap((dependency) => {
    const target = layout[dependency];

    if (target?.kind === 'app') {
      return [`${name} has ${dependency} as a dev dependency, an app: nothing imports an app`];
    }

    if (entry.domain === 'generic' && target?.domain === 'coding') {
      return [
        `${name} is generic but its tests depend on ${dependency}, a coding workspace: they must run without a project`,
      ];
    }

    return [];
  });

  return [
    ...identityProblems({ name, entry }),
    ...entry.dependsOn.map((dependency) => edgeProblem({ name, entry, dependency, layout })),
    ...devProblems,
    ...exportsProblems({ name, entry }),
  ].filter(Boolean);
}

/** What is wrong with `layout`: each workspace's domain, name and graph. */
export function layoutProblems(layout) {
  return Object.entries(layout).flatMap(([name, entry]) => entryProblems({ name, entry, layout }));
}

const TYPESCRIPT = /\.[cm]?tsx?$/;

/** What to do about TypeScript outside every workspace's `src/`. */
export const STRAY_SOURCE =
  "source lives in a workspace's src/. Move it, or list why it isn't source in NOT_SOURCE (packages/eslint-config/src/layout.js).";

/**
 * `file` matches `glob`. A trailing `/**` takes everything below, dot folders included
 * (`path.matchesGlob` skips those, and a fixture's `.sheavly/` is still not harness source).
 */
function matchesPath(params) {
  const { file, glob } = params;

  return glob.endsWith('/**') ? file.startsWith(glob.slice(0, -2)) : path.matchesGlob(file, glob);
}

/**
 * True when `file` (`/`-separated, from the root) is TypeScript outside every workspace's `src/`
 * and `notSource` doesn't say why it may be.
 */
export function isStraySource(params) {
  const { workspaces, file, notSource = NOT_SOURCE } = params;
  const sources = workspaces.map(({ relative }) =>
    relative === '.' ? 'src/' : `${relative}/src/`,
  );

  return (
    TYPESCRIPT.test(file) &&
    !sources.some((src) => file.startsWith(src)) &&
    !Object.keys(notSource).some((glob) => matchesPath({ file, glob }))
  );
}
