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

  it.each([
    new WorkspaceError('Path is outside the workspace'),
    new PathCheckError({ path: 'a.ts', cause: { code: 'EACCES' } }),
  ])('turns a refused or unchecked path into forbidden: %s', async (error) => {
    const failure = await run(failWith(error)).catch((caughtError: unknown) => caughtError);

    expect(failure).toMatchObject({ reason: 'forbidden', message: error.message });
  });

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
