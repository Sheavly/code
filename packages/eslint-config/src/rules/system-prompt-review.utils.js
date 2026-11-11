import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  inventoryManifest,
  inventoryPath,
  inventoryWorkspaceDirs,
} from './system-prompt-review-confinement.utils.js';

const EXCLUDED_FOLDERS = new Set(['__tests__', 'testing', 'tests', 'test', 'fakes', 'fake']);

function productionWorkspace(params) {
  const { root, dir } = params;
  const { sheavly } = inventoryManifest({ root, dir });

  return sheavly?.testOnly !== true && sheavly?.domain !== 'tooling';
}

function modelFacingFiles(params) {
  const { root, dir } = params;

  if (!inventoryPath({ root, file: dir, skipLinks: true })?.isDirectory()) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return EXCLUDED_FOLDERS.has(entry.name) ? [] : modelFacingFiles({ root, dir: file });
    }

    return entry.isFile() && /\.(tool|prompt)\.ts$/.test(entry.name) ? [file] : [];
  });
}

function siblingConstants(params) {
  const { root, tool } = params;
  const dir = path.dirname(tool);

  inventoryPath({ root, file: dir });

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.constants.ts'))
    .map((entry) => path.join(dir, entry.name));
}

/** The base is hashed separately from its review comment to avoid a circular inventory hash. */
export const PROMPT_REVIEW_ANCHOR = 'packages/host/src/instructions/instructions.prompt.ts';

/**
 * Absolute, sorted production prompt/tool files and their sibling constants, discovered afresh.
 * The base prompt is checked from the current lint buffer instead. This is not a dependency
 * closure; symlinks, test/fake folders and test-only/tooling workspaces are excluded.
 */
export function watchedPromptSources(suppliedRoot) {
  const root = path.resolve(suppliedRoot);
  const sources = inventoryWorkspaceDirs(root)
    .filter((dir) => productionWorkspace({ root, dir }))
    .flatMap((dir) => modelFacingFiles({ root, dir: path.join(dir, 'src') }))
    .filter((file) => file !== path.join(root, PROMPT_REVIEW_ANCHOR));
  const constants = sources.flatMap((tool) => siblingConstants({ root, tool }));

  return [...new Set([...sources, ...constants])].sort();
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * `prompt` is the exact SourceCode text inside the static template's backticks (not cooked text).
 * Hashes include formatting: a review signal, not proof of semantic correctness. Inventory paths
 * are root-relative POSIX paths, sorted and JSON-framed with full UTF-8 sources, so moves count and
 * roots do not. No cache: repeated editor lints see even same-size, same-mtime source changes.
 * Filesystem/discovery errors propagate to callers rather than silently omitting sources.
 */
export function promptReviewHashes(params) {
  const { root, prompt } = params;
  const sources = watchedPromptSources(root).map((file) => {
    inventoryPath({ root: path.resolve(root), file });

    return [path.relative(root, file).split(path.sep).join('/'), readFileSync(file, 'utf8')];
  });

  sources.sort(([left], [right]) => (left < right ? -1 : Number(left > right)));

  return { sourcesHash: sha256(JSON.stringify(sources)), promptHash: sha256(prompt) };
}
