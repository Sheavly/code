/** Why a folder can't hold the server's lock socket and discovery file. */
export type DirectoryProblem = 'dir-not-ours' | 'dir-unwritable';

/** What is wrong with a folder that is not private to the user. */
export type DirectoryDetail =
  'missing' | 'symlink' | 'not-directory' | 'other-owner' | 'too-open' | 'unreadable';

/** The result of `checkPrivateDirectory`: a verdict, never a throw. */
export type PrivateDirectoryCheck =
  | { status: 'private' }
  | {
      status: 'refused';
      problem: DirectoryProblem;
      detail: DirectoryDetail;
      cause?: unknown;
    };

/** A folder a server of one home may have published in, as `serverRuntimeCandidates` lists it. */
export type RuntimeCandidate = { directory: string; source: 'xdg' | 'home' };

/** The result of `serverRuntimeDirectory`. */
export type ServerRuntimeDirectory =
  | {
      status: 'ready';
      directory: string;
      source: 'xdg' | 'home';
      /** Set when `$XDG_RUNTIME_DIR` was set but could not be used, so the home folder was used. */
      warning?: string;
    }
  | {
      status: 'unusable';
      directory: string;
      problem: DirectoryProblem;
      detail: DirectoryDetail;
      cause?: unknown;
    };
