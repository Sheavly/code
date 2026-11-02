import { realpathSync } from 'node:fs';
import { builtinModules, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectHooksError } from '../errors/project-hooks.errors.js';

/** Hook folders (real paths) whose files may only import inside themselves. */
const confined = new Set<string>();
let registered = false;

/** True if `file` is `folder` or inside it. */
function isInside(params: { folder: string; file: string }): boolean {
  const relative = path.relative(params.folder, params.file);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The confined folder `parentURL` belongs to, if any: only hook files are restricted. */
function confinedFolderOf(parentURL: string | undefined): string | undefined {
  if (!parentURL?.startsWith('file:')) return undefined;

  const parent = fileURLToPath(parentURL);

  return [...confined].find((folder) => isInside({ folder, file: parent }));
}

/** `node:fs`, `fs`, `fs/promises`: always allowed, they're not code from the repo. */
function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

/**
 * What a confined hook file may import: Node builtins, and files whose real path is inside its
 * hook folder. Anything else (`../src/x.js`, a package, a symlink out) is code the trust
 * fingerprint doesn't cover, so it's refused: otherwise a later change to it would run on an old
 * "yes".
 */
function checkImport(params: { specifier: string; folder: string; resolvedURL: string }): void {
  const { specifier, folder, resolvedURL } = params;

  if (isBuiltin(specifier)) return;

  const target = resolvedURL.startsWith('file:') ? realpathSync(fileURLToPath(resolvedURL)) : '';

  if (target && isInside({ folder, file: target })) return;

  throw new ProjectHooksError(
    `A .sheavly hook may only import Node built-ins and files inside .sheavly/ (it imported "${specifier}"). Code outside .sheavly/ isn't covered by workspace trust, so a later change to it would run without asking. Move the code into .sheavly/, or use \`import type\` for types.`,
  );
}

/**
 * Confines every file under `folder` to importing only inside it (and Node builtins), from now on
 * in this process. Registered once; each loaded hook folder is added to it.
 */
export function confineImports(params: { folder: string }): void {
  confined.add(realpathSync(params.folder));
  if (registered) return;
  registered = true;

  registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const folder = confinedFolderOf(context.parentURL);

      // A package is outside .sheavly/ wherever it would resolve: refused before looking it up.
      if (folder && !isBuiltin(specifier) && !/^[./]|^file:/.test(specifier)) {
        checkImport({ specifier, folder, resolvedURL: '' });
      }

      const resolved = nextResolve(specifier, context);

      if (folder) checkImport({ specifier, folder, resolvedURL: resolved.url });

      return resolved;
    },
  });
}
