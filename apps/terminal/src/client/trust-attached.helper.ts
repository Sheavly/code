import path from 'node:path';
import { createClient } from '@sheavly/client/client/client.helper';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import { BackendError } from '../errors/backend.errors.js';
import { TRUST_TIMEOUT_MS } from './client.constants.js';
import type { Backend } from './client.types.js';
import { refusalLine } from './trust-reason.utils.js';

/**
 * Sends `--trust` to a backend the terminal only connected to (`BACKEND_URL`) and returns the
 * folder the conversation must open in. One folder is used for both, so what is trusted is what
 * runs: `workspace`, or the one a started backend would trust (`WORKSPACE_ROOT`, else the current
 * folder), which then becomes the conversation's workspace too. A backend the terminal started
 * already got `--trust` as its own flag, and without `--trust` nothing is sent: `workspace` is
 * returned as it came. The request ends after `timeoutMs` (`TRUST_TIMEOUT_MS`).
 *
 * Throws `BackendError` naming the folder when the backend refuses, cannot be reached or does not
 * answer in time; its text is one capped line without the token, and no cause is kept. The one
 * exception is a run that named no folder (the demo) whose own folder the backend refuses as a
 * workspace: that run goes on in the backend's default folder, untrusted, and says so.
 */
export async function trustFolderOnAttached(params: {
  backend: Backend;
  args: readonly string[];
  workspace: string | undefined;
  env: NodeJS.ProcessEnv;
  write: (text: string) => void;
  timeoutMs?: number;
}): Promise<string | undefined> {
  const { backend, args, env, write, timeoutMs = TRUST_TIMEOUT_MS } = params;

  if (!backend.attached || !args.includes('--trust')) return params.workspace;

  const folder = params.workspace ?? path.resolve(env.WORKSPACE_ROOT ?? process.cwd());
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    await createClient(backend).send('trustWorkspace', { body: { workspace: folder }, signal });

    return folder;
  } catch (caughtError) {
    if (signal.aborted) {
      throw new BackendError({
        message: `--trust: the running backend did not answer in ${String(timeoutMs / 1000)} s`,
      });
    }

    const reason = reasonOf({ caughtError, token: backend.token });

    if (params.workspace === undefined && isFolderRefusal(caughtError)) {
      write(
        `⚠ --trust: ${folder} cannot be used as a workspace (${reason}); the run goes on in the backend's own folder, which is not trusted\n`,
      );

      return undefined;
    }

    // No `cause`: the client's error carries the backend's own text, which may echo the token.
    throw new BackendError({
      message: `--trust: the running backend did not trust ${folder} (${reason})`,
    });
  }
}

/** The backend said the folder itself cannot be a workspace, as opposed to refusing to trust. */
function isFolderRefusal(caughtError: unknown): boolean {
  return caughtError instanceof RefusedError && caughtError.status === 422;
}

/** What a person needs of a failure: the backend's refusal as one short line, or the kind of error. */
function reasonOf(params: { caughtError: unknown; token: string }): string {
  const { caughtError, token } = params;

  if (caughtError instanceof RefusedError) {
    return `${String(caughtError.status)} ${refusalLine({ text: caughtError.message, token })}`;
  }

  return caughtError instanceof Error
    ? refusalLine({ text: caughtError.name, token })
    : 'an unknown error';
}
