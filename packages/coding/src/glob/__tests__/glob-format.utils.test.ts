import { describe, expect, it } from 'vitest';
import { formatGlob } from '../glob-format.utils.js';
import type { GlobResult } from '../glob.types.js';

const outputs = [
  { files: ['src/new.ts', 'src/old.ts'], body: 'src/new.ts\nsrc/old.ts' },
  { files: [], body: 'No files match *.ts in src.' },
];

describe('glob formatting equivalence', () => {
  it.each(outputs)('preserves output and ordered notes for $files', ({ files, body }) => {
    for (const truncated of [false, true]) {
      for (const skipped of ['', 'src/private: Permission denied']) {
        const result: GlobResult = {
          kind: 'glob_files',
          pattern: '*.ts',
          searched: 'src',
          files,
          truncated,
          skipped,
        };
        const original = structuredClone(result);
        const expected = [
          body,
          ...(truncated
            ? [
                `[Showing the newest of the files found, ${files.length} in all; there are more. Narrow the pattern or path.]`,
              ]
            : []),
          ...(skipped
            ? [`[Some folders could not be read, so results may be incomplete: ${skipped}]`]
            : []),
        ].join('\n');

        expect(formatGlob(result)).toBe(expected);
        expect(result).toEqual(original);
      }
    }
  });
});
