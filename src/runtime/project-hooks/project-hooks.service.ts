import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { Workspace } from '../workspace/workspace.service.js';
import { HOOKS_MANIFEST, SHEAVLY_DIR } from './project-hooks.constants.js';
import { ProjectHooksError } from './project-hooks.errors.js';
import type { HooksManifest } from './project-hooks.types.js';
import { explainImportError, hooksManifestSchema, parseHookExport } from './project-hooks.utils.js';

/**
 * Loads the hooks listed in `<root>/.sheavly/hooks.json`, in manifest order (disabled entries
 * skipped). No manifest means no hooks; anything broken throws a `ProjectHooksError` naming the
 * file, so a misconfigured hook stops startup instead of being silently skipped.
 *
 * Hook files are loaded with a plain `import()`: JavaScript or TypeScript (Node strips the
 * types), ESM or CommonJS. Call it once at startup and pass the hooks to the loop after the
 * host's own: `hooks: [...hostHooks, ...projectHooks]`.
 */
export async function loadProjectHooks(params: { root: string }): Promise<Hook[]> {
  const dir = path.join(params.root, SHEAVLY_DIR);
  const manifest = await readManifest(path.join(dir, HOOKS_MANIFEST));

  if (!manifest) return [];

  // Hook files must stay inside .sheavly/: the workspace sandbox rejects `../` and symlinks out.
  const folder = await Workspace.open(dir);
  const hooks: Hook[] = [];

  for (const entry of manifest.hooks) {
    if (!entry.enabled) continue;
    const hook = await loadHookFile({ folder, file: entry.path });

    if (hooks.some((loaded) => loaded.name === hook.name)) {
      throw new ProjectHooksError(
        `${label(entry.path)}: another hook is already named "${hook.name}"`,
      );
    }

    hooks.push(hook);
  }

  return hooks;
}

async function readManifest(file: string): Promise<HooksManifest | undefined> {
  let text: string;

  try {
    text = await readFile(file, 'utf8');
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw caughtError;
  }

  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (caughtError) {
    const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

    throw new ProjectHooksError(`${label(HOOKS_MANIFEST)} is not valid JSON: ${reason}`);
  }

  const parsed = hooksManifestSchema.safeParse(json);

  if (!parsed.success) {
    throw new ProjectHooksError(
      `Invalid ${label(HOOKS_MANIFEST)}:\n${z.prettifyError(parsed.error)}`,
    );
  }

  return parsed.data;
}

async function loadHookFile(params: { folder: Workspace; file: string }): Promise<Hook> {
  const { folder, file } = params;
  const resolved = await folder.resolveRead(file).catch((caughtError: unknown) => {
    const missing = (caughtError as NodeJS.ErrnoException).code === 'ENOENT';
    const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

    throw new ProjectHooksError(`${label(file)}: ${missing ? 'file not found' : reason}`);
  });

  let module: { default?: unknown };

  try {
    module = (await import(pathToFileURL(resolved).href)) as { default?: unknown };
  } catch (caughtError) {
    throw new ProjectHooksError(
      `${label(file)} failed to load: ${explainImportError({ file, caughtError })}`,
    );
  }

  if (module.default === undefined) {
    throw new ProjectHooksError(
      `${label(file)} must export its hook as the default: \`export default { ... }\` (ESM) or \`module.exports = { ... }\` (CommonJS)`,
    );
  }

  const result = parseHookExport(module.default);

  if ('error' in result) {
    throw new ProjectHooksError(`${label(file)} is not a valid hook:\n${result.error}`);
  }

  return result.hook;
}

function label(file: string): string {
  return path.join(SHEAVLY_DIR, file);
}
