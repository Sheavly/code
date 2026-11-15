import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { HistoryFile } from '../history-file.service.js';

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'history-file-'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const files = () => ({
  file: path.join(folder, 'history.jsonl'),
  legacyFile: path.join(folder, 'history.json'),
});
const user = (content: string): HistoryMessage => ({ role: 'user', content, at: 1 });

async function seqsOf(log: HistoryFile): Promise<number[]> {
  const seqs: number[] = [];

  for await (const record of log.read()) seqs.push(record.seq);

  return seqs;
}

describe('HistoryFile migration', () => {
  it('imports a history stored whole, in order, and continues the log after it', async () => {
    const { file, legacyFile } = files();

    await writeFile(legacyFile, JSON.stringify([user('a'), user('b')]));

    const log = new HistoryFile({ file, legacyFile });

    expect(await seqsOf(log)).toEqual([0, 1]);
    await log.append([{ seq: 2, entry: user('c') }]);
    expect(await seqsOf(new HistoryFile({ file, legacyFile }))).toEqual([0, 1, 2]);
    // Imported once, so no second copy is left behind to drift.
    await expect(readFile(legacyFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a sub-agent’s legacy file too, after its log is written', async () => {
    const agent = '7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20';
    const file = path.join(folder, `${agent}.history.jsonl`);
    const legacyFile = path.join(folder, `${agent}.history.json`);

    await writeFile(legacyFile, JSON.stringify([user('a')]));

    expect(await seqsOf(new HistoryFile({ file, legacyFile }))).toEqual([0]);
    await expect(readFile(legacyFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the legacy file when the import wrote nothing, so no history is lost', async () => {
    const { file, legacyFile } = files();

    await writeFile(legacyFile, '{"not":"a history"}');
    await expect(seqsOf(new HistoryFile({ file, legacyFile }))).rejects.toBeDefined();
    expect(await readFile(legacyFile, 'utf8')).toContain('not');
  });

  it('does not import again once the log exists, even if the legacy file changed', async () => {
    const { file, legacyFile } = files();

    await writeFile(legacyFile, JSON.stringify([user('a')]));
    await seqsOf(new HistoryFile({ file, legacyFile }));
    await writeFile(legacyFile, JSON.stringify([user('a'), user('b'), user('c')]));

    expect(await seqsOf(new HistoryFile({ file, legacyFile }))).toEqual([0]);
  });

  it('starts empty with neither file, and refuses a legacy file that is not a history', async () => {
    const { file, legacyFile } = files();

    expect(await seqsOf(new HistoryFile({ file, legacyFile }))).toEqual([]);

    await writeFile(legacyFile, '{"not":"a history"}');
    await expect(seqsOf(new HistoryFile({ file, legacyFile }))).rejects.toMatchObject({
      name: 'StoreError',
    });
  });
});

describe('HistoryFile crashes', () => {
  it('trims a record cut off by a crash before the next one joins onto it', async () => {
    const { file, legacyFile } = files();

    await writeFile(file, `${JSON.stringify({ seq: 0, entry: user('a') })}\n{"seq":1,"ent`);

    const log = new HistoryFile({ file, legacyFile });

    await log.append([{ seq: 1, entry: user('b') }]);
    expect(await seqsOf(log)).toEqual([0, 1]);
  });

  it('refuses a log with a gap rather than hiding the lost record', async () => {
    const { file, legacyFile } = files();

    await writeFile(file, `${JSON.stringify({ seq: 0, entry: user('a') })}\n`);
    await appendFile(file, `${JSON.stringify({ seq: 2, entry: user('c') })}\n`);

    await expect(seqsOf(new HistoryFile({ file, legacyFile }))).rejects.toMatchObject({
      name: 'StoreError',
    });
  });
});
