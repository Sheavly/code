import { errorCode, errorMessage } from '@sheavly/runtime/errors/errors.utils';

/**
 * A process group couldn't be killed for a reason other than having exited already (`ESRCH`),
 * e.g. `EPERM`. Its commands may still be running, so this is reported, never ignored.
 */
export class ProcessKillError extends Error {
  override name = 'ProcessKillError';
  /** The process group's leader. */
  readonly pid: number;
  readonly code: string | undefined;

  constructor(params: { pid: number; cause: unknown }) {
    const { pid, cause } = params;
    const code = errorCode(cause);

    super(
      `Could not stop process group ${pid} (${code ?? errorMessage(cause)}); it may still be running`,
      { cause },
    );
    this.pid = pid;
    this.code = code;
  }
}

/** The run was interrupted before the command could start, so it never ran. */
export class ProcessInterruptedError extends Error {
  override name = 'ProcessInterruptedError';

  constructor() {
    super('Interrupted before the command started');
  }
}
