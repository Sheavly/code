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

const logFile = () => path.join(folder, 'history.jsonl');
const user = (content: string): HistoryMessage => ({ role: 'user', content, at: 1 });

async function seqsOf(log: HistoryFile): Promise<number[]> {
  const seqs: number[] = [];

  for await (const record of log.read()) seqs.push(record.seq);

  return seqs;
}

describe('HistoryFile', () => {
  it('starts empty and ignores a whole-file history.json beside it, leaving it in place', async () => {
    const stale = path.join(folder, 'history.json');
    const log = new HistoryFile({ file: logFile() });

    await writeFile(stale, JSON.stringify([user('a'), user('b')]));

    expect(await seqsOf(log)).toEqual([]);
    await log.append([{ seq: 0, entry: user('c') }]);
    expect(await seqsOf(new HistoryFile({ file: logFile() }))).toEqual([0]);
    expect(await readFile(stale, 'utf8')).toContain('"a"');
  });
});

describe('HistoryFile crashes', () => {
  it('trims a record cut off by a crash before the next one joins onto it', async () => {
    const file = logFile();

    await writeFile(file, `${JSON.stringify({ seq: 0, entry: user('a') })}\n{"seq":1,"ent`);

    const log = new HistoryFile({ file });

    await log.append([{ seq: 1, entry: user('b') }]);
    expect(await seqsOf(log)).toEqual([0, 1]);
  });

  it('refuses a log with a gap rather than hiding the lost record', async () => {
    const file = logFile();

    await writeFile(file, `${JSON.stringify({ seq: 0, entry: user('a') })}\n`);
    await appendFile(file, `${JSON.stringify({ seq: 2, entry: user('c') })}\n`);

    await expect(seqsOf(new HistoryFile({ file }))).rejects.toMatchObject({
      name: 'StoreError',
    });
  });
});
