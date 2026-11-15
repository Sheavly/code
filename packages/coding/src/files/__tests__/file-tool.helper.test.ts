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
    ['EACCES', 'Permission denied: a.ts.'],
    ['EISDIR', 'Not a file: a.ts.'],
    ['ELOOP', 'Too many symbolic links: a.ts.'],
  ])(
    'tells the model %s in a fixed phrase, never the system text with its host path',
    async (code, said) => {
      const raw = Object.assign(new Error(`${code}: /home/user/secret/a.ts`), { code });
      const failure = await run(failWith(raw)).catch((caughtError: unknown) => caughtError);

      expect(failure).toMatchObject({ reason: 'forbidden', message: said });
    },
  );

  it('leaves a tool error, an abort and any other failure as they were', async () => {
    const own = new ToolCallError({ reason: 'invalid_input', message: 'mine' });
    const other = Object.assign(new Error('disk on fire'), { code: 'EIO' });
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
