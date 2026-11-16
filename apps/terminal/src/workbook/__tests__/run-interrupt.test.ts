import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { SAME_KEYPRESS_MS } from '../../render/render.constants.js';
import { fakeRunRequest, useWorkbookRunEnvironment } from '../../testing/workbook-run.fake.js';
import { useTempFolders } from '../../testing/temp-folders.fake.js';
import { BackendError } from '../../errors/backend.errors.js';
import { WorkbookStore } from '../store.service.js';
import { connectBackend } from '../../client/backend.helper.js';
import { runWorkbook } from '../run.helper.js';

vi.mock('../../client/backend.helper.js', () => ({ connectBackend: vi.fn() }));

const clock = useFixedClock();
const folders = useTempFolders();

useWorkbookRunEnvironment();

/**
 * Starts a run whose backend start is still going, and waits until it is. It ends when Ctrl+C
 * aborts it, as `connectBackend` does; with `stuck` it never ends, so only a force quit can.
 */
async function runStartingBackend(params: { stuck?: boolean } = {}) {
  const store = new WorkbookStore(path.join(await folders.make('workbook-interrupt'), 'workbook'));

  vi.mocked(connectBackend).mockImplementation(
    ({ signal }) =>
      new Promise((_, reject) => {
        if (params.stuck) return;

        signal?.addEventListener(
          'abort',
          () => reject(new BackendError({ message: 'Interrupted while the backend was starting' })),
          { once: true },
        );
      }),
  );

  const running = runWorkbook({ store, request: fakeRunRequest('hi') });

  await vi.waitFor(() => expect(connectBackend).toHaveBeenCalled());

  return { store, running };
}

describe('workbook run: Ctrl+C', () => {
  it('during the backend start saves the run as interrupted, not as a crash', async () => {
    const { store, running } = await runStartingBackend();

    process.emit('SIGINT');

    const result = await running;

    expect(result.outcome).toBe('interrupted');
    expect((await store.result(result.id))?.outcome).toBe('interrupted');
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('ignores the same keypress seen twice', async () => {
    const { running } = await runStartingBackend();

    process.emit('SIGINT');
    process.emit('SIGINT');
    await expect(running).resolves.toMatchObject({ outcome: 'interrupted' });
  });

  it('force-quits on a second press after the window, leaving the run folder readable', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { store } = await runStartingBackend({ stuck: true });

    process.emit('SIGINT');
    clock.advance(SAME_KEYPRESS_MS);
    process.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));

    const [id] = await store.runIds();

    if (!id) throw new Error('the run folder was not made');

    // The recorder's files were closed first: the transcript has the force-quit notice.
    expect(await readFile(store.paths(id).transcript, 'utf8')).toContain('Forced exit');
    expect(await store.result(id)).toBeUndefined();
    process.removeAllListeners('SIGINT');
  });
});
