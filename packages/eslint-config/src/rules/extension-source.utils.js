import path from 'node:path';
import { listWorkspaces, readLayout, workspaceOfFile } from '../layout.utils.js';
import { isTestOrFake } from '../test-paths.utils.js';

/** True if `file` is non-test source of a workspace the layout calls an extension. */
export function isExtensionSource(params) {
  const { root, options, file } = params;
  const workspace = workspaceOfFile({ workspaces: listWorkspaces(root), file });

  if (!workspace || isTestOrFake(path.relative(workspace.dir, file))) return false;

  const layout = options.layout ?? readLayout({ root });

  return layout[workspace.name]?.kind === 'extension';
}
