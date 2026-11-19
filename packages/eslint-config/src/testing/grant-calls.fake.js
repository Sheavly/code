// Test-only: throwaway extension workspaces for `harness/extension-declares-grants`, holding the
// real mapping and the real contract files of this repo (or overrides of them) and a manifest.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONTRACT_FILES } from '../extension-contract.utils.js';
import { RUN_SERVICE_GRANTS_FILE } from '../run-service-grants.utils.js';
import { EXTENSION_WORKSPACES, REPO_ROOT } from './extension-rule.fake.js';
import { tempWorkspace } from './workspace.fake.js';

export const [KEYS_FILE, TYPES_FILE, ERRORS_FILE] = CONTRACT_FILES;
export { RUN_SERVICE_GRANTS_FILE };
export const KEYS = '@sheavly/extension/run-services/run-services.utils';
export const TYPES = '@sheavly/extension/run-services/run-services.types';

/** The manifest the messages name: the workspace the cases lint is `extensions/web`. */
const MANIFEST = 'extensions/web/sheavly.json';

const SOURCE_FILE = 'extensions/web/src/web/web.helper.ts';
const REAL_FILES = Object.fromEntries(
  [...CONTRACT_FILES, RUN_SERVICE_GRANTS_FILE].map((file) => [
    file,
    readFileSync(path.join(REPO_ROOT, file), 'utf8'),
  ]),
);
const workspaces = new Map();

/**
 * A throwaway repo whose `extensions/web` lists `grants` in its manifest (or is `manifest`, a
 * string or JSON value; `null` for none), with `files` laid over the real contract and mapping
 * files and `omit` dropping files by path. Returns the linted file and the rule's options, and is
 * built once per distinct input.
 */
function grantWorkspace(params = {}) {
  const { grants = [], manifest, files = {}, omit = [] } = params;
  // `undefined` (the default manifest) and `null` (none) must not share a key.
  const key = JSON.stringify([grants, manifest ?? String(manifest), files, omit]);
  const known = workspaces.get(key);

  if (known) return known;

  const tree = {
    ...EXTENSION_WORKSPACES,
    ...REAL_FILES,
    [MANIFEST]: manifest === undefined ? { name: 'web', grants } : manifest,
    ...files,
  };

  for (const file of [...omit, ...(manifest === null ? [MANIFEST] : [])]) delete tree[file];

  const root = tempWorkspace(tree);
  const workspace = { root, file: path.join(root, SOURCE_FILE), options: [{ root }] };

  workspaces.set(key, workspace);

  return workspace;
}

/** The RuleTester error for a call that lacks `grant`. */
export function missing(call, grant) {
  return { messageId: 'missing', data: { call, grant, manifest: MANIFEST } };
}

/**
 * A RuleTester case that lints `code` as production source of a workspace whose manifest lists
 * `grants`; `errors` (`missing(...)` values) makes it an invalid case. Other params go to
 * `grantWorkspace`, and `file` (from the repo root) lints another file of that workspace.
 */
export function grantCase(params) {
  const { code, errors, file, ...rest } = params;
  const workspace = grantWorkspace(rest);
  const filename = file ? path.join(workspace.root, file) : workspace.file;

  return { code, filename, options: workspace.options, ...(errors ? { errors } : {}) };
}
