// An extension that provides a service with grants (its `sheavly.json` `services.grants`) must
// prove in a test that each grant is enforced: the host verifies the grants exist, but only the
// provider's own methods check them. The proof is the testing kit's `assertServiceEnforcesGrants`,
// so a workspace that declares service grants needs a test that imports it and calls it. Read from
// the manifests and the files, with the helper's specifier taken from the package that holds it
// (`exports` and `src/testing/`), never a list of names. It proves a call expression exists in a
// test of the workspace; whether it runs, hits the real provider, covers every method, or is per
// service is review's (docs/rules.md lists the limits).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readSheavlyJson } from './extension-manifest.utils.js';
import { listWorkspaces } from './layout.utils.js';

const HELPER_FILE = 'service-grants.fake';
const HELPER_EXPORT = 'assertServiceEnforcesGrants';
const TEST_FILE = /\.test\.[cm]?tsx?$/;

/** Every workspace that holds the helper file behind a `./testing/*` export. */
function helperHolders(workspaces) {
  return workspaces.filter(
    ({ dir, manifest }) =>
      manifest.exports?.['./testing/*'] !== undefined &&
      existsSync(path.join(dir, 'src', 'testing', `${HELPER_FILE}.ts`)),
  );
}

/**
 * The package subpath tests import the helper from, or null when no workspace holds it or more
 * than one does (then there is no one specifier to demand: `serviceGrantTestProblems` reports it).
 */
export function helperSpecifier(workspaces) {
  const holders = helperHolders(workspaces);

  return holders.length === 1 ? `${holders[0].name}/testing/${HELPER_FILE}` : null;
}

/** The services of `manifest` data whose `services.grants` list at least one grant. */
function servicesWithGrants(data) {
  const grants = data?.services?.grants;

  if (typeof grants !== 'object' || grants === null) return [];

  return Object.entries(grants)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([service]) => service);
}

const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The regex source that matches a call to the helper through its local binding or a namespace. */
function callPattern(binding) {
  if (binding.namespace) {
    return `(^|[^\\w$.])${escaped(binding.local)}\\s*\\.\\s*${HELPER_EXPORT}\\s*[(<]`;
  }

  return `(^|[^\\w$.])${escaped(binding.local)}\\s*[(<]`;
}

/** The helper bindings one import clause (`{ a as b }`, `* as ns`, `D, { a }`) introduces. */
function clauseBindings(clause) {
  const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
  const namespace = /\*\s*as\s+([\w$]+)/.exec(clause)?.[1];
  const direct = named
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/))
    .filter(([imported]) => imported === HELPER_EXPORT)
    .map(([imported, alias]) => ({ local: alias ?? imported, namespace: false }));

  return namespace ? [...direct, { local: namespace, namespace: true }] : direct;
}

/**
 * What a test file does with the helper: `{ imported, called }`. Imported means any import of
 * `specifier` in the file brings the helper in: a named import (an alias counts) or a namespace
 * import (`import * as kit`). Called means a binding is called outside the imports and outside
 * comments (`prove(`, or `kit.assertServiceEnforcesGrants(`). It reads text, not syntax: it does
 * not know whether the call runs, and a re-export of the helper is not an import here.
 */
export function helperUse(params) {
  const { text, specifier } = params;
  const source = withoutComments(text);
  const statement = new RegExp(
    `import\\s+(?!type\\b)([^;'"]*?)\\s*from\\s*['"]${escaped(specifier)}['"];?`,
    'g',
  );
  const bindings = [...source.matchAll(statement)].flatMap(([, clause]) => clauseBindings(clause));

  if (bindings.length === 0) return { imported: false, called: false };

  const rest = source.replace(statement, '');

  return {
    imported: true,
    called: bindings.some((binding) => new RegExp(callPattern(binding)).test(rest)),
  };
}

/** The `__tests__/*.test.ts` files under a workspace's `src/`, absolute. */
function testFiles(dir) {
  const src = path.join(dir, 'src');

  if (!existsSync(src)) return [];

  return readdirSync(src, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        TEST_FILE.test(entry.name) &&
        path.basename(entry.parentPath) === '__tests__',
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function workspaceProblem(params) {
  const { workspace, services, specifier } = params;
  const uses = testFiles(workspace.dir).map((file) =>
    helperUse({ text: readFileSync(file, 'utf8'), specifier }),
  );

  if (uses.some(({ called }) => called)) return [];

  const where = `${workspace.name} provides ${services.join(', ')} with services.grants`;

  if (uses.some(({ imported }) => imported)) {
    return [
      `${where}: a test imports ${HELPER_EXPORT} but none calls it. Call it with the extension, one call per grant.`,
    ];
  }

  return [
    `${where}, but no test under ${workspace.relative}/src/**/__tests__/ calls ${HELPER_EXPORT} from '${specifier}'. The provider enforces its grants, and only a test can show each call refuses without its grant.`,
  ];
}

/**
 * What is missing in the repo at `root`: for each extension workspace whose `sheavly.json`
 * declares service grants, a test file that imports and calls the helper. An extension with none
 * is not asked for one; a manifest that cannot be read is the layout check's to report.
 */
export function serviceGrantTestProblems(params) {
  const { root } = params;
  const workspaces = listWorkspaces(root);
  const holders = helperHolders(workspaces);
  const specifier = helperSpecifier(workspaces);
  const asking = workspaces
    .filter(({ relative }) => relative.startsWith('extensions/'))
    .map((workspace) => ({
      workspace,
      services: servicesWithGrants(readSheavlyJson(workspace.dir).data),
    }))
    .filter(({ services }) => services.length > 0);

  // Which holder to demand is not derivable: one problem for the repo, not one per extension.
  if (holders.length > 1 && asking.length > 0) {
    return [
      `${holders.map(({ name }) => name).join(', ')} all have src/testing/${HELPER_FILE}.ts behind a './testing/*' export, so the helper to prove service grants with is ambiguous. Keep it in one workspace.`,
    ];
  }

  return asking.flatMap(({ workspace, services }) => {
    if (specifier === null) {
      return [
        `${workspace.name} declares service grants, but no workspace has src/testing/${HELPER_FILE}.ts with a './testing/*' export to prove them with`,
      ];
    }

    return workspaceProblem({ workspace, services, specifier });
  });
}
