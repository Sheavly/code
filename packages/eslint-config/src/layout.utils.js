// Reads the workspace layout (`layout.js`) against the workspaces on disk: which workspace a file
// belongs to, and what is wrong with the layout itself. The rule (`rules/layout.js`) and the
// layout check (`scripts/check-layout.mjs`) both use it, so they can't disagree.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LAYOUT } from './layout.js';
import { workspaceDirs } from './rules/workspace-types.js';

/** Every workspace on disk (the root app and each `workspaces` match): its dir and name. */
export function listWorkspaces(root) {
  return workspaceDirs(root).map((dir) => ({
    dir,
    relative: path.relative(root, dir).split(path.sep).join('/') || '.',
    name: JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name,
  }));
}

/** The workspace `file` belongs to: the deepest workspace dir that holds it. */
export function workspaceOfFile(params) {
  const { workspaces, file } = params;

  return workspaces
    .filter(({ dir }) => file === dir || file.startsWith(`${dir}${path.sep}`))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
}

/** A layer's entry, as `{ testOnly, dependsOn }` whether it was written as a list or an object. */
function layerEntry(entry) {
  return Array.isArray(entry)
    ? { testOnly: false, dependsOn: entry }
    : { testOnly: false, ...entry };
}

function graphProblems(params) {
  const { name, entry, layout } = params;

  return entry.dependsOn.flatMap((dependency) => {
    const target = layout[dependency];

    if (!target) return [`${name} depends on ${dependency}, which the layout doesn't list`];

    if (target.kind === 'app') {
      return [`${name} depends on ${dependency}, an app: nothing imports an app`];
    }

    if (entry.domain === 'generic' && target.domain === 'coding') {
      return [`${name} is generic but depends on ${dependency}, a coding workspace`];
    }

    if (target.domain === 'tooling') {
      return [`${name} depends on ${dependency}, a tooling workspace: source never imports it`];
    }

    return [];
  });
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

/** What is wrong with `layout` on its own: its graph and the layers of the app being split. */
export function layoutProblems(layout = LAYOUT) {
  return Object.entries(layout).flatMap(([name, entry]) => [
    ...(['package', 'app'].includes(entry.kind) ? [] : [`${name} has kind ${entry.kind}`]),
    ...(['generic', 'coding', 'tooling'].includes(entry.domain)
      ? []
      : [`${name} has domain ${entry.domain}`]),
    ...graphProblems({ name, entry, layout }),
    ...layerProblems({ name, entry, layout }),
  ]);
}
