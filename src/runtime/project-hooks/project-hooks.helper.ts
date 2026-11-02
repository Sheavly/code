import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { Workspace } from '../workspace/workspace.service.js';
import { confineImports } from './confine.helper.js';
import type { TrustStore } from '../trust/trust.service.js';
import { HOOKS_MANIFEST, SHEAVLY_DIR } from './project-hooks.constants.js';
import { ProjectHooksError } from '../errors/project-hooks.errors.js';
import type { HooksManifest, ProjectHooks } from './project-hooks.types.js';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { explainImportError } from './project-hooks.utils.js';
import { hooksManifestSchema, parseHookExport } from './project-hooks.validator.js';

/**
 * Loads the hooks listed in `<root>/.sheavly/hooks.json`, in manifest order (disabled entries
 * skipped), but only for a workspace the user trusts: hook files are code from the repo, and
 * loading them runs it. `trust` is the user's trust store; `grant` trusts the workspace first
 * (a host's `--trust`). An untrusted workspace, or one whose `.sheavly/` changed since it was
 * trusted, loads nothing and says so in `trust`: no hook file is even imported.
 *
 * No manifest means no hooks (`no_hooks`); anything broken throws a `ProjectHooksError` naming
 * the file, so a misconfigured hook stops startup instead of being silently skipped.
 *
 * Hook files are loaded with a plain `import()`: JavaScript or TypeScript (Node strips the
 * types), ESM or CommonJS. Call it once at startup and pass the hooks to the loop after the
 * host's own: `hooks: [...hostHooks, ...projectHooks.hooks]`.
 */
export async function loadProjectHooks(params: {
  root: string;
  trust: TrustStore;
  grant?: boolean;
}): Promise<ProjectHooks> {
  const { root, trust, grant = false } = params;
  const dir = path.join(root, SHEAVLY_DIR);
  const text = await readManifestText(path.join(dir, HOOKS_MANIFEST));

  if (text === undefined) return { hooks: [], trust: 'no_hooks' };
  if (grant) await trust.trust({ root });

  const state = await trust.check({ root });

  // An untrusted manifest isn't even parsed: a broken one can't stop the host, it's just skipped.
  if (state !== 'trusted') return { hooks: [], trust: state };

  const manifest = parseManifest(text);

  // Hook files must stay inside .sheavly/: the workspace sandbox rejects `../` and symlinks out.
  // What they import must too: code outside .sheavly/ isn't covered by the trust fingerprint.
  const folder = await Workspace.open(dir);

  confineImports({ folder: folder.root });
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

  return { hooks, trust: 'trusted' };
}

/** The manifest's text, or undefined when there is none (no project hooks). */
async function readManifestText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw caughtError;
  }
}

function parseManifest(text: string): HooksManifest {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (caughtError) {
    const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

    throw new ProjectHooksError(`${label(HOOKS_MANIFEST)} is not valid JSON: ${reason}`);
  }

  return parseOrThrow({
    schema: hooksManifestSchema,
    input: json,
    onInvalid: ({ details, error }) =>
      new ProjectHooksError(`Invalid ${label(HOOKS_MANIFEST)}:\n${details}`, { cause: error }),
  });
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
