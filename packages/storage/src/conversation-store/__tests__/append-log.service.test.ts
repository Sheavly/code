import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { AppendLog } from '../append-log.service.js';

const temp = useTempFolder('append-log-');
const itemSchema = z.object({ seq: z.number() });

async function seqsOf(log: AppendLog<{ seq: number }>) {
  const seqs: number[] = [];

  for await (const item of log.read()) seqs.push(item.seq);

  return seqs;
}

describe('AppendLog retry after a partial write', () => {
  it('accepts a retry of items whose lines already reached the file, without duplicating them', async () => {
    let failures = 1;
    const log = new AppendLog({
      file: path.join(temp.path(), 'log.jsonl'),
      schema: itemSchema,
      noun: 'Log',
      unit: 'item',
      // Fails after the line was written, as a failing projection does.
      observe: async () => {
        if (failures-- > 0) throw new Error('projection failed');
      },
    });

    await expect(log.append([{ seq: 0 }, { seq: 1 }])).rejects.toMatchObject({
      name: 'StoreError',
    });
    await log.append([{ seq: 0 }, { seq: 1 }]);
    await log.append([{ seq: 2 }]);

    expect(await seqsOf(log)).toEqual([0, 1, 2]);
  });

  it('still refuses an old seq when no append failed before it', async () => {
    const log = new AppendLog({
      file: path.join(temp.path(), 'log.jsonl'),
      schema: itemSchema,
      noun: 'Log',
      unit: 'item',
    });

    await log.append([{ seq: 0 }]);
    await expect(log.append([{ seq: 0 }])).rejects.toMatchObject({ reason: 'out_of_order' });
  });
});
