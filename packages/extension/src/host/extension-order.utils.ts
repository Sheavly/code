import { ExtensionGraphError } from '../errors/extension.errors.js';
import type { Extension } from '../extension/extension.types.js';

function indexByName(extensions: readonly Extension[]): Map<string, Extension> {
  const byName = new Map<string, Extension>();

  for (const extension of extensions) {
    if (byName.has(extension.name)) {
      throw new ExtensionGraphError({
        extensions: [extension.name],
        problem: `Two extensions are named "${extension.name}". Rename one of them.`,
      });
    }

    byName.set(extension.name, extension);
  }

  return byName;
}

function assertDependenciesExist(byName: ReadonlyMap<string, Extension>): void {
  for (const extension of byName.values()) {
    const missing = extension.dependsOn.find((name) => !byName.has(name));

    if (missing === undefined) continue;

    throw new ExtensionGraphError({
      extensions: [extension.name, missing],
      problem: `Extension ${extension.name} depends on "${missing}", which is not loaded. Add it, or remove the dependency.`,
    });
  }
}

/**
 * The extensions in activation order: each after everything it depends on, and otherwise in the
 * order given (so the order a UI lists them stays meaningful). Throws an `ExtensionGraphError` for
 * a repeated name, a dependency that is not loaded, or a cycle (named in full).
 */
export function orderExtensions(extensions: readonly Extension[]): Extension[] {
  const byName = indexByName(extensions);

  assertDependenciesExist(byName);

  const ordered: Extension[] = [];
  const done = new Set<string>();

  const visit = (extension: Extension, path: readonly string[]): void => {
    if (done.has(extension.name)) return;

    if (path.includes(extension.name)) {
      const cycle = [...path.slice(path.indexOf(extension.name)), extension.name];

      throw new ExtensionGraphError({
        extensions: cycle,
        problem: `Extensions depend on each other in a cycle: ${cycle.join(' -> ')}.`,
      });
    }

    // Every name is in `byName`: `assertDependenciesExist` ran first.
    for (const name of extension.dependsOn) {
      const dependency = byName.get(name);

      if (dependency) visit(dependency, [...path, extension.name]);
    }

    done.add(extension.name);
    ordered.push(extension);
  };

  for (const extension of extensions) visit(extension, []);

  return ordered;
}

/**
 * The extensions of `ordered` named in `roots`, and every one that depends on one of them,
 * directly or not, in the order given. `ordered` must come from `orderExtensions`, so a dependency
 * is listed before what depends on it.
 */
export function withDependents(params: {
  ordered: readonly Extension[];
  roots: ReadonlySet<string>;
}): Extension[] {
  const { ordered, roots } = params;
  const hit = new Set(roots);

  return ordered.filter((extension) => {
    if (extension.dependsOn.some((name) => hit.has(name))) hit.add(extension.name);

    return hit.has(extension.name);
  });
}

/**
 * For each extension, the names whose services it may read: itself and everything it depends on,
 * directly or not. `ordered` must come from `orderExtensions`, so dependencies are listed first.
 */
export function readableServices(ordered: readonly Extension[]): Map<string, ReadonlySet<string>> {
  const readable = new Map<string, ReadonlySet<string>>();

  for (const extension of ordered) {
    const names = new Set([extension.name]);

    for (const dependency of extension.dependsOn) {
      for (const name of readable.get(dependency) ?? []) names.add(name);
    }

    readable.set(extension.name, names);
  }

  return readable;
}
