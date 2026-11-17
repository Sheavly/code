import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReplayNotFoundError } from '../../errors/replay.errors.js';
import { WorkbookNotFoundError } from '../../errors/workbook.errors.js';
import { useTempFolders } from '../../testing/temp-folders.fake.js';
import { replayFolder } from '../replay-target.helper.js';

const temp = useTempFolders();

describe('replayFolder', () => {
  it('takes a path to a folder as it is', async () => {
    const folder = await temp.make('replay');

    await expect(replayFolder(folder)).resolves.toBe(folder);
  });

  it('refuses a path that is not there, saying it is not a folder, not that no run exists', async () => {
    const folder = await temp.make('replay');
    const missing = path.join(folder, 'conversations', 'xyz');

    await expect(replayFolder(missing)).rejects.toThrow(ReplayNotFoundError);
    await expect(replayFolder(missing)).rejects.toThrow('is not a folder');
  });

  it('refuses a path to a file', async () => {
    const folder = await temp.make('replay');
    const file = path.join(folder, 'stream.jsonl');

    await writeFile(file, '');

    await expect(replayFolder(file)).rejects.toThrow(ReplayNotFoundError);
  });

  it('reads a bare word as a workbook run, never as a folder of that name', async () => {
    await expect(replayFolder('no-such-run-9999')).rejects.toThrow(WorkbookNotFoundError);
  });
});
