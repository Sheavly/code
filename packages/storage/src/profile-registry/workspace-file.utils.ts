import type { z } from 'zod';
import { workspaceKey } from '../config-store/config-store.utils.js';
import { WORKSPACE_FILE } from '../profile-store/profile-store.constants.js';
import type { workspaceFileSchema } from './workspace-file.validator.js';

/**
 * Why a workspace folder named `key` is not usable, or `undefined` when it is. `file` is its
 * `workspace.json`, or `undefined` when there is none. The folder's name is a hash of the path in
 * that file, so a folder moved or renamed by hand, whose name no longer matches, is refused
 * rather than trusted. Pure.
 */
export function workspaceFileProblem(params: {
  file: z.infer<typeof workspaceFileSchema> | undefined;
  key: string;
}): string | undefined {
  const { file, key } = params;

  if (file === undefined) {
    return `it has no ${WORKSPACE_FILE}, so it is not known which path it is for`;
  }

  if (workspaceKey({ realPath: file.root }) !== key) {
    return `${WORKSPACE_FILE} names a path that is not this folder's`;
  }

  return undefined;
}
