// Errors the Cursor hooks throw, so a caller (the guard wrapper, a test) can tell them apart by
// class instead of by message. Each names the file it couldn't use and keeps the cause.

function describe(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** True when a path isn't there (it, or a folder on the way, doesn't exist); never on EACCES. */
export function isMissingPath(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

/** This chat's recorded state (its issue, approvals) exists but is unreadable or corrupt. */
export class HookStateError extends Error {
  name = 'HookStateError';

  constructor(params) {
    const { file, cause } = params;

    super(`Chat state ${file} could not be read (delete it to start over): ${describe(cause)}`, {
      cause,
    });
    this.file = file;
  }
}

/** A project file or folder a hook relies on (the src/ scopes, the skill, its own state). */
export class ProjectReadError extends Error {
  name = 'ProjectReadError';

  constructor(params) {
    const { file, cause } = params;

    super(`Could not read ${file}: ${describe(cause)}`, { cause });
    this.file = file;
  }
}

/**
 * A guard hook crashed instead of deciding. The guard denies with this message, so the reason
 * reaches the user and the agent; `failClosed` in hooks.json covers a crash before that.
 */
export class GuardCrashError extends Error {
  name = 'GuardCrashError';

  constructor(params) {
    const { guard, cause } = params;

    super(`The ${guard} guard failed, so it denied to be safe: ${describe(cause)}`, { cause });
    this.guard = guard;
  }
}
