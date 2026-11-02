// Reads the workspace layout from the workspaces themselves (see `layout.js` for what comes from
// where): which workspace a file belongs to, and what is wrong with the layout. The rules
// (`rules/layout.js`, `rules/imports.js`), the layout check (`scripts/check-layout.mjs`) and the
// scaffold (`scripts/new-workspace.mjs`) all use it, so they can't disagree.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NOT_SOURCE, SPLIT_APP } from './layout.js';
import { workspaceDirs } from './rules/workspace-types.js';

/**
 * The options of the rules that read the layout: tests point them at a temp workspace (`root`),
 * a layout of their own, or another split app.
 */
export const LAYOUT_RULE_OPTIONS = {
  type: 'object',
  properties: {
    root: { type: 'string' },
    layout: { type: 'object' },
    splitApp: { type: 'object' },
  },
  additionalProperties: false,
};

const DOMAINS = ['generic', 'coding', 'tooling'];
const SCOPE = '@sheavly/';
const toPosix = (file) => file.split(path.sep).join('/');

/** Every workspace on disk (the root app and each `workspaces` match): where it is and its manifest. */
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

/** `packages/*` is a package; `apps/*` and the root are apps. */
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
 * and `testOnly` from its `sheavly` field, and the split app's `layers` from `SPLIT_APP`.
 */
export function readLayout(params) {
  const { root, splitApp = SPLIT_APP } = params;
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
        ...(relative === splitApp.dir ? { layers: splitApp.layers } : {}),
      },
    ]),
  );
}

/** The workspace `file` belongs to: the deepest workspace dir that holds it. */
export function workspaceOfFile(params) {
  const { workspaces, file } = params;

  return workspaces
    .filter(({ dir }) => file === dir || file.startsWith(`${dir}${path.sep}`))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
}

/** A layer's entry, as `{ testOnly, dependsOn }` whether it was written as a list or an object. */
export function layerEntry(entry) {
  return Array.isArray(entry)
    ? { testOnly: false, dependsOn: entry }
    : { testOnly: false, ...entry };
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
function edgeProblem(params) {
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

function layerProblems(params) {
  const { name, entry, layout } = params;
  const layers = entry.layers ?? {};

  return Object.entries(layers).flatMap(([layer, raw]) =>
    layerEntry(raw)
      .dependsOn.filter(
        (dependency) => !(dependency in layers) && !entry.dependsOn.includes(dependency),
      )
      .map((dependency) =>
        dependency in layout
          ? `${name}'s layer ${layer} imports ${dependency}, which ${name} doesn't depend on`
          : `${name}'s layer ${layer} imports ${dependency}, which is neither a layer nor a workspace`,
      ),
  );
}

function identityProblems(params) {
  const { name, entry } = params;
  const problems = [];

  if (!DOMAINS.includes(entry.domain)) {
    problems.push(`${name} has no domain: run \`${domainCommand(entry.dir)}\``);
  }

  const folder = path.posix.basename(entry.dir);

  if (!entry.layers && name !== `${SCOPE}${folder}`) {
    problems.push(`${name} must be named ${SCOPE}${folder}, after its folder`);
  }

  return problems;
}

/** What is wrong with one workspace's entry: its domain, its name, its edges and its layers. */
export function entryProblems(params) {
  const { name, entry, layout } = params;
  const devProblems = entry.devDependsOn
    .filter(
      (dependency) => layout[dependency]?.domain !== 'tooling' && !layout[dependency]?.testOnly,
    )
    .map(
      (dependency) =>
        `${name} has ${dependency} as a dev dependency, but only tooling and test-only workspaces may be: make it a dependency`,
    );

  return [
    ...identityProblems({ name, entry }),
    ...entry.dependsOn.map((dependency) => edgeProblem({ name, entry, dependency, layout })),
    ...devProblems,
    ...layerProblems({ name, entry, layout }),
  ].filter(Boolean);
}

/** What is wrong with `layout`: each workspace's domain, name and graph, and the split app's layers. */
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
