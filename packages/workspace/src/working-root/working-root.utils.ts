import path from 'node:path';
import { isInside } from '../workspace/workspace.utils.js';

/**
 * The path a tool should hand the workspace: `requested` made absolute against the working root,
 * so `src/index.ts` means the root's file. An absolute path, or any path while no root is set,
 * is returned as it is, and the workspace still decides whether it is reachable.
 */
export function anchorToRoot(params: { requested: string; root: string | undefined }): string {
  const { requested, root } = params;

  if (root === undefined || path.isAbsolute(requested)) return requested;

  return path.resolve(root, requested);
}

/** `absolute` as shown to a person: relative to `root` when it is inside it, else as it is. */
export function showFromRoot(params: { absolute: string; root: string | undefined }): string {
  const { absolute, root } = params;

  if (root === undefined || !isInside({ folder: root, target: absolute })) return absolute;

  return path.relative(root, absolute) || '.';
}
