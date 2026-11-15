import { describe, expect, it } from 'vitest';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { PathCheckError, WorkspaceError } from '@sheavly/workspace/errors/workspace.errors';
import { runFileTool } from '../file-tool.helper.js';

const signal = new AbortController().signal;
const failWith = (error: Error) => () => Promise.reject(error);
const run = (body: () => Promise<unknown>, abort: AbortSignal = signal) =>
  runFileTool({ requested: 'a.ts', signal: abort, run: body });

describe('runFileTool', () => {
  it('returns what the body returns', async () => {
    expect(await run(() => Promise.resolve('done'))).toBe('done');
  });

  it('fails an already aborted call before running the body', async () => {
    let ran = false;
    const aborted = AbortSignal.abort(new Error('stopped'));

    await expect(
      run(() => {
        ran = true;

        return Promise.resolve();
      }, aborted),
    ).rejects.toThrow('stopped');
    expect(ran).toBe(false);
  });

  it.each(['ENOENT', 'ENOTDIR'])('turns %s into not_found naming the path', async (code) => {
    const failure = await run(failWith(Object.assign(new Error('raw'), { code }))).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(failure).toBeInstanceOf(ToolCallError);
    expect(failure).toMatchObject({ reason: 'not_found', message: 'File not found: a.ts.' });
  });

  it('turns a path the workspace refused into forbidden, with its own message', async () => {
    const error = new WorkspaceError('Path is outside the workspace: a.ts');
    const failure = await run(failWith(error)).catch((caughtError: unknown) => caughtError);

    expect(failure).toMatchObject({ reason: 'forbidden', message: error.message });
  });

  it('turns a path it could not check into forbidden, never with the system text or a host path', async () => {
    const error = new PathCheckError({
      path: '/home/user/secret/a.ts',
      cause: Object.assign(new Error('EIO: /home/user/secret/a.ts'), { code: 'EIO' }),
    });
    const failure = await run(failWith(error)).catch((caughtError: unknown) => caughtError);

    expect(failure).toMatchObject({ reason: 'forbidden', message: 'Could not check a.ts (EIO).' });
  });

  it.each([
    ['EACCES', 'forbidden', 'Permission denied: a.ts.'],
    ['EROFS', 'forbidden', 'Read-only file system: a.ts.'],
    ['EISDIR', 'invalid_input', 'Not a file: a.ts.'],
    ['ELOOP', 'invalid_input', 'Too many symbolic links: a.ts.'],
    ['ENAMETOOLONG', 'invalid_input', 'Path too long: a.ts.'],
    ['EEXIST', 'invalid_input', 'Something is already there: a.ts.'],
    ['EMFILE', 'unavailable', 'Too many open files: a.ts.'],
    ['EBUSY', 'unavailable', 'File is busy: a.ts.'],
    ['ENOSPC', 'unavailable', 'No space left on the device: a.ts.'],
    // Any other system code gets a fixed phrase with the code, and is not a permission problem.
    ['EXDEV', 'unavailable', 'The file system refused the operation (EXDEV): a.ts.'],
  ])(
    'tells the model %s as %s in a fixed phrase, never the system text with its host path',
    async (code, reason, said) => {
      const raw = Object.assign(new Error(`${code}: /home/user/secret/a.ts`), { code });
      const failure = await run(failWith(raw)).catch((caughtError: unknown) => caughtError);

      expect(failure).toMatchObject({ reason, message: said });
    },
  );

  it.each(['ECONNRESET_X', 'E', 'EXTREMELYLONGERRORCODEHERE', 'e1', 'ERR CODE'])(
    'leaves a code that is not a short system code (%s) as it was',
    async (code) => {
      const raw = Object.assign(new Error('x'), { code });

      await expect(run(failWith(raw))).rejects.toBe(raw);
    },
  );

  it('leaves a tool error, an abort and any other failure as they were', async () => {
    const own = new ToolCallError({ reason: 'invalid_input', message: 'mine' });
    // Not a system error (no `E` code), so it is not ours to rename.
    const other = Object.assign(new Error('disk on fire'), { code: 'custom' });
    const reason = new Error('stopped');
    const controller = new AbortController();

    await expect(run(failWith(own))).rejects.toBe(own);
    await expect(run(failWith(other))).rejects.toBe(other);
    await expect(
      run(() => {
        controller.abort(reason);

        return Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' }));
      }, controller.signal),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
