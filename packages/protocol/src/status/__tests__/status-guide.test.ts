import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusTableMarkdown } from '../status.utils.js';

const GUIDE = join(
  import.meta.dirname,
  '../../../../..',
  '.agents/skills/sheavly/state-machines.md',
);

/** A table's rows as their trimmed cells, so Prettier's column padding does not matter. */
function cellsOf(table: string): string[][] {
  return table
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s|:-]+$/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe('the state-machines guide', () => {
  it('prints the status table as it is (rewrite the block between the markers from statusTableMarkdown)', async () => {
    const guide = await readFile(GUIDE, 'utf8');
    const [, rest = ''] = guide.split('<!-- status-table:start -->');
    const [printed = ''] = rest.split('<!-- status-table:end -->');

    expect(cellsOf(printed)).toEqual(cellsOf(statusTableMarkdown()));
  });
});
