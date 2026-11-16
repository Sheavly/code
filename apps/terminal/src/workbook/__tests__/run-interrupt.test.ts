import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { connectBackend } from '../../client/backend.helper.js';
import { BackendError } from '../../errors/backend.errors.js';
import { SAME_KEYPRESS_MS } from '../../render/render.constants.js';
import { fakeRunRequest, useWorkbookRunEnvironment } from '../../testing/workbook-run.fake.js';
import { runWorkbook } from '../run.helper.js';
import { WorkbookStore } from '../store.service.js';

vi.mock('../../client/backend.helper.js', () => ({ connectBackend: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));

const clock = useFixedClock();
const environment = useWorkbookRunEnvironment();

async function newStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'workbook-interrupt-'));

  environment.keep(root);

  return new WorkbookStore(path.join(root, 'workbook'));
}

/** A backend start that ends only when Ctrl+C aborts it, as `connectBackend` does. */
function startingBackend() {
  vi.mocked(connectBackend).mockImplementation(
    ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new BackendError({ message: 'Interrupted while the backend was starting' })),
          { once: true },
        );
      }),
  );
}

/** A backend start that never answers, so only a force quit can end the run. */
function stuckBackend() {
  vi.mocked(connectBackend).mockReturnValue(new Promise(() => undefined));
}

describe('workbook run: Ctrl+C', () => {
  it('during the backend start saves the run as interrupted, not as a crash', async () => {
    const store = await newStore();

    startingBackend();

    const running = runWorkbook({ store, request: fakeRunRequest('hi') });

    await vi.waitFor(() => expect(connectBackend).toHaveBeenCalled());
    process.emit('SIGINT');

    const result = await running;

    expect(result.outcome).toBe('interrupted');
    expect((await store.result(result.id))?.outcome).toBe('interrupted');
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('ignores the same keypress seen twice', async () => {
    const store = await newStore();

    startingBackend();

    const running = runWorkbook({ store, request: fakeRunRequest('hi') });

    await vi.waitFor(() => expect(connectBackend).toHaveBeenCalled());
    process.emit('SIGINT');
    process.emit('SIGINT');
    await expect(running).resolves.toMatchObject({ outcome: 'interrupted' });
  });

  it('force-quits on a second press after the window, leaving the run folder readable', async () => {
    const store = await newStore();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    stuckBackend();
    void runWorkbook({ store, request: fakeRunRequest('hi') });
    await vi.waitFor(() => expect(connectBackend).toHaveBeenCalled());
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
