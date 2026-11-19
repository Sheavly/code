import path from 'node:path';
import { listWorkspaces, readLayout, workspaceOfFile } from '../layout.utils.js';
import { isTestOrFake } from '../test-paths.utils.js';
import { findRoot } from './workspace-types.js';

const SOURCE_FILE = /\.[cm]?tsx?$/;

/** The text of a string literal or an expression-free template, else undefined (a computed path). */
export function literalText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;

  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? undefined;
  }

  return undefined;
}

/**
 * The repo root when the linted file is extension source (a TypeScript file of an extension
 * workspace that is not a test or a fake), else undefined: the rule then has nothing to check.
 * Reads the root from the rule's `root` option, else from the working directory.
 */
export function extensionRootOf(context) {
  const options = context.options[0] ?? {};
  const root = options.root ?? findRoot(context.cwd);

  // Cheap checks first: a file that is not extension source pays for no parse or stat.
  if (!root || !SOURCE_FILE.test(context.filename)) return undefined;

  return isExtensionSource({ root, options, file: context.filename }) ? root : undefined;
}

/** True if `file` is non-test source of a workspace the layout calls an extension. */
export function isExtensionSource(params) {
  const { root, options, file } = params;
  const workspace = workspaceOfFile({ workspaces: listWorkspaces(root), file });

  if (!workspace || isTestOrFake(path.relative(workspace.dir, file))) return false;

  const layout = options.layout ?? readLayout({ root });

  return layout[workspace.name]?.kind === 'extension';
}
