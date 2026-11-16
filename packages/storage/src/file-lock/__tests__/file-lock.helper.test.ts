import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';
import { ConfigStore } from '../../config-store/config-store.service.js';
import { CredentialStore } from '../../credential-store/credential-store.service.js';
import { DocumentFile } from '../../document-file/document-file.service.js';
import { StorageFileError } from '../../errors/storage.errors.js';
import { PermissionStore } from '../../permission-store/permission-store.service.js';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { LOCK_STALE_MS } from '../file-lock.constants.js';
import { withFileLock } from '../file-lock.helper.js';

const run = promisify(execFile);
const temp = useTempFolder('file-lock-');
const WORKER = path.join(import.meta.dirname, '../../testing/lock-worker.fake.ts');
const CHANGES = 12;

// The condition makes workspace packages resolve to their source, as in vitest: a checkout that
// has not been built (CI) has no `dist` to import.
const startWorker = (params: { root: string; name: string }) =>
  run(
    process.execPath,
    [
      '--conditions=@sheavly/source',
      '--import',
      'tsx',
      WORKER,
      params.root,
      params.name,
      String(CHANGES),
    ],
    { cwd: import.meta.dirname },
  );

describe('two processes on one folder', () => {
  it('lose no update in config, credentials, permissions or a document', async () => {
    const root = temp.path();

    await mkdir(root, { recursive: true });
    await Promise.all([startWorker({ root, name: 'a' }), startWorker({ root, name: 'b' })]);

    const config = await new ConfigStore({ root }).read();
    const credentials = await new CredentialStore({
      folder: path.join(root, 'profile'),
    }).fieldsSet();
    const document = await new DocumentFile({ file: path.join(root, 'trust.json') }).load();
    const permissions = await new PermissionStore({ root }).read(root);

    expect(Object.keys(config.workspaces)).toHaveLength(2 * CHANGES);
    expect(Object.keys(credentials)).toHaveLength(2 * CHANGES);
    expect(Object.keys(document as object)).toHaveLength(2 * CHANGES);
    expect(permissions.allow).toHaveLength(2 * CHANGES);
  }, 60_000);
});

describe('withFileLock', () => {
  it('runs one task at a time and releases the lock when a task fails', async () => {
    const name = path.join(temp.path(), 'guarded.json');
    const order: string[] = [];
    const slow = withFileLock({
      name,
      task: async () => {
        order.push('slow:start');
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push('slow:end');
      },
    });
    const failing = withFileLock({
      name,
      task: async () => {
        order.push('failing');

        return Promise.reject(new Error('boom'));
      },
    });

    await Promise.allSettled([slow, failing]);
    await withFileLock({ name, task: async () => order.push('after') });

    // Which caller gets the lock first is not promised; that the slow task is never interrupted
    // and that the lock is free after a failure is.
    expect(order.indexOf('slow:end') - order.indexOf('slow:start')).toBe(1);
    expect(order.at(-1)).toBe('after');
    expect(order).toHaveLength(4);
  });

  it('takes over a lock left by a process that is gone, and an unfinished one that is too old', async () => {
    const name = path.join(temp.path(), 'stale.json');
    const lock = `${name}.lock`;

    await mkdir(temp.path(), { recursive: true });
    await writeFile(lock, '2147483646:token');
    expect(await withFileLock({ name, task: async () => 'gone' })).toBe('gone');

    // A crash between creating the lock and writing who holds it leaves it empty.
    await writeFile(lock, '');

    const oldSeconds = (now() - LOCK_STALE_MS - 1000) / 1000;

    await utimes(lock, oldSeconds, oldSeconds);
    expect(await withFileLock({ name, task: async () => 'unfinished' })).toBe('unfinished');
  });

  it('releases only its own lock: one a later holder made is left alone', async () => {
    const name = path.join(temp.path(), 'taken.json');
    const lock = `${name}.lock`;

    await mkdir(temp.path(), { recursive: true });
    await withFileLock({
      name,
      task: async () => {
        // The lock was taken over while this task ran (it was judged stale by mistake).
        await writeFile(lock, `${String(process.pid)}:someone-else`);
      },
    });

    expect(await readFile(lock, 'utf8')).toBe(`${String(process.pid)}:someone-else`);
  });

  it('leaves no stale file behind after a takeover', async () => {
    const name = path.join(temp.path(), 'clean.json');

    await mkdir(temp.path(), { recursive: true });
    await writeFile(`${name}.lock`, '2147483646:token');
    await withFileLock({ name, task: async () => 1 });

    expect(await readdir(temp.path())).toEqual([]);
  });

  it('names the lock file when it cannot be taken', async () => {
    const name = path.join(temp.path(), 'held.json');

    await mkdir(temp.path(), { recursive: true });
    await writeFile(`${name}.lock`, String(process.pid));

    const waiting = withFileLock({ name, task: async () => 1 });

    await expect(waiting).rejects.toBeInstanceOf(StorageFileError);
    await expect(waiting).rejects.toThrow(/held\.json\.lock/);
  }, 30_000);
});
