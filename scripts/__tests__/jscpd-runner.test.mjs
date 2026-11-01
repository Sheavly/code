import { afterEach, describe, expect, it } from 'vitest';
import { ignoredJscpdConfig, readJscpdConfig, runJscpd } from '../jscpd-runner.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

const VALID = JSON.stringify({ path: ['src'], format: ['typescript'] });

afterEach(removeTempRepos);

describe('readJscpdConfig', () => {
  it.each([
    ['missing', undefined],
    ['unparseable', '{ "path": ["src"], broken'],
    ['empty', '{}'],
    ['scanning no path', '{"path":[],"format":["typescript"]}'],
    ['scanning no format', '{"path":["src"],"format":[]}'],
  ])('fails before jscpd runs when .jscpd.json is %s', (_label, config) => {
    const root = createTempRepo(config === undefined ? {} : { '.jscpd.json': config });

    expect(() => readJscpdConfig(root)).toThrow(/\.jscpd\.json/);
  });

  it('returns a config that names what to scan', () => {
    expect(readJscpdConfig(createTempRepo({ '.jscpd.json': VALID }))).toEqual(JSON.parse(VALID));
  });
});

describe('ignoredJscpdConfig', () => {
  it("recognises jscpd's warning about an unreadable config", () => {
    const warning = 'config file .jscpd.json line 1: key must be a string at line 1 column 18';

    expect(ignoredJscpdConfig(`${warning}\nNo duplicates found.`)).toBe(true);
    expect(ignoredJscpdConfig('Using config from .jscpd.json\nFound 0 clones.')).toBe(false);
  });
});

describe('runJscpd', () => {
  it('fails a scan that matches no files', () => {
    const root = createTempRepo({ '.jscpd.json': VALID, 'src/.keep': '' });

    expect(runJscpd({ repoRoot: root, args: ['--silent'] })).not.toBe(0);
  });

  it('passes a configured scan over real files without clones', () => {
    // jscpd only counts a file as analysed once it reaches its minimum token count (50).
    const source = [1, 2, 3, 4]
      .map(
        (n) =>
          `export function scale${n}(value: number): number {\n  return value * ${n} + 1;\n}\n`,
      )
      .join('\n');
    const root = createTempRepo({ '.jscpd.json': VALID, 'src/a.ts': source });

    expect(runJscpd({ repoRoot: root, args: ['--silent'] })).toBe(0);
  });
});
