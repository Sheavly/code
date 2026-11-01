/** A path was rejected by the workspace sandbox (outside the root, broken symlink, ...). */
export class WorkspaceError extends Error {
  override name = 'WorkspaceError';
}
