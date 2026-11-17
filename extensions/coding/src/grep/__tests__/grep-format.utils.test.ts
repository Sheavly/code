import { describe, expect, it } from 'vitest';
import { formatGrep } from '../grep-format.utils.js';
import type { GrepResult } from '../grep.types.js';

const base = {
  kind: 'grep_matches' as const,
  pattern: 'needle',
  searched: 'src',
  skipped: '',
  truncated: false,
};
const outputs: { result: GrepResult; body: string; count: number }[] = [
  {
    result: {
      ...base,
      mode: 'content',
      matches: [{ path: 'src/a.ts', line: 2, text: 'a needle: here' }],
    },
    body: 'src/a.ts:2:a needle: here',
    count: 1,
  },
  {
    result: { ...base, mode: 'files', files: ['src/a.ts', 'src/new\nline.ts'] },
    body: 'src/a.ts\nsrc/new\nline.ts',
    count: 2,
  },
  {
    result: { ...base, mode: 'count', counts: [{ path: 'src/a.ts', count: 3 }] },
    body: 'src/a.ts:3',
    count: 1,
  },
  {
    result: { ...base, mode: 'content', matches: [] },
    body: 'No matches for needle in src.',
    count: 0,
  },
];

describe('grep formatting equivalence', () => {
  it.each(outputs)(
    'preserves $result.mode output and ordered notes ($count results)',
    (fixture) => {
      for (const truncated of [false, true]) {
        for (const skipped of ['', 'src/private: Permission denied']) {
          const result = { ...fixture.result, truncated, skipped };
          const original = structuredClone(result);
          const expected = [
            fixture.body,
            ...(truncated
              ? [
                  `[Showing the first ${fixture.count} results; there are more. Narrow the search with path or glob, or a more specific pattern.]`,
                ]
              : []),
            ...(skipped
              ? [`[Some files could not be searched, so results may be incomplete: ${skipped}]`]
              : []),
          ].join('\n');

          expect(formatGrep({ result, skipped })).toBe(expected);
          expect(result).toEqual(original);
        }
      }
    },
  );
});
