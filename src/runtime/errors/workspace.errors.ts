import { errorCode, errorMessage } from '@sheavly/runtime/errors/errors.utils';

/** A path was rejected by the workspace sandbox (outside the root, broken symlink, ...). */
export class WorkspaceError extends Error {
  override name = 'WorkspaceError';
}

/**
 * The sandbox couldn't check a path at all (`EACCES`, `ELOOP`, `EIO`, ...). Unlike a missing
 * path, this is never "fine": a caller treats the path as unchecked, so it fails closed or asks.
 */
export class PathCheckError extends Error {
  override name = 'PathCheckError';
  /** The path as it was requested. */
  readonly path: string;
  /** The system error code, when there is one. */
  readonly code: string | undefined;

  constructor(params: { path: string; cause: unknown }) {
    const { path, cause } = params;
    const code = errorCode(cause);

    super(`Could not check ${path} (${code ?? errorMessage(cause)})`, { cause });
    this.path = path;
    this.code = code;
  }
}
