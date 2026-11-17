import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
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
 * host's own: `hooks: [...hostHooks, ...projectHooks.hooks]`. Pass those as `hostHooks` too: a
 * project hook named like one of them, or like an earlier project hook, throws a
 * `ProjectHooksError` naming both.
 *
 * Hooks are loaded once per process and never reloaded: Node caches each module, so a later call
 * returns the code first imported. A change to `.sheavly/` takes effect on restart.
 */
export async function loadProjectHooks(params: {
  root: string;
  trust: TrustStore;
  grant?: boolean;
  /** The host's own hooks, whose names a project hook may not reuse. */
  hostHooks?: readonly Hook[];
}): Promise<ProjectHooks> {
  const { root, trust, grant = false, hostHooks = [] } = params;
  const dir = path.join(root, SHEAVLY_DIR);
  const manifestFile = path.join(dir, HOOKS_MANIFEST);

  // Only whether it is there: an untrusted repo's manifest is not read before the trust check.
  if (!(await manifestExists(manifestFile))) return { hooks: [], trust: 'no_hooks' };
  if (grant) await trust.trust({ root });

  const state = await trust.check({ root });

  // An untrusted manifest isn't even parsed: a broken one can't stop the host, it's just skipped.
  if (state !== 'trusted') return { hooks: [], trust: state };

  // Read after the check, so the text parsed is the one the fingerprint covered, not an earlier one.
  const text = await readManifestText(manifestFile);

  if (text === undefined) {
    throw new ProjectHooksError(
      `${label(HOOKS_MANIFEST)} disappeared while the hooks were loading`,
    );
  }

  const manifest = parseManifest(text);

  // Hook files must stay inside .sheavly/: the workspace sandbox rejects `../` and symlinks out.
  // What they import must too: code outside .sheavly/ isn't covered by the trust fingerprint.
  const folder = await Workspace.open(dir);

  confineImports({ folder: folder.root });
  const hooks: Hook[] = [];
  const sources = new Map(hostHooks.map((hook) => [hook.name, 'a host hook']));

  for (const entry of manifest.hooks) {
    if (!entry.enabled) continue;
    await assertStillTrusted({ trust, root });
    const hook = await loadHookFile({ folder, file: entry.path });

    assertNameFree({ sources, name: hook.name, file: entry.path });
    sources.set(hook.name, label(entry.path));
    hooks.push(hook);
  }

  // The last import is covered too: a change made while it ran must not come back as `trusted`.
  await assertStillTrusted({ trust, root });

  return { hooks, trust: 'trusted' };
}

/** Two hooks with one name can't be told apart in logs and errors, so the second one fails the load. */
function assertNameFree(params: {
  sources: ReadonlyMap<string, string>;
  name: string;
  file: string;
}): void {
  const { sources, name, file } = params;
  const taken = sources.get(name);

  if (taken === undefined) return;

  throw new ProjectHooksError(
    `${label(file)}: hook name "${name}" is already used by ${taken}. Rename one of them.`,
  );
}

/**
 * Re-checks trust right before each hook file is imported, and once after the last, so a change
 * to `.sheavly/` after the first check stops the load. It narrows the gap to the `import()`
 * itself but cannot close it: Node reads the file after this returns, a file's own imports and a
 * handler's lazy `import()` run later still, and earlier hooks' top-level code has already run
 * when a later check fails. Each check hashes all of `.sheavly/`, so a hook whose top-level code
 * writes there fails the load.
 */
async function assertStillTrusted(params: { trust: TrustStore; root: string }): Promise<void> {
  if ((await params.trust.check({ root: params.root })) === 'trusted') return;

  throw new ProjectHooksError(
    '.sheavly/ changed after the trust check, so the hooks were not used. Trust the workspace again.',
  );
}

/** Whether the manifest is there. It reads nothing, so a directory, a FIFO or a huge file costs nothing. */
async function manifestExists(file: string): Promise<boolean> {
  try {
    await stat(file);

    return true;
  } catch (caughtError) {
    if ((caughtError as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw caughtError;
  }
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
