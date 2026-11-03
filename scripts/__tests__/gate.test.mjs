import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file) => readFileSync(path.join(REPO_ROOT, file), 'utf8');

describe('the quality gate', () => {
  // A baseline lets old findings pass, and once it is empty it is only machinery: fix the
  // finding in code instead.
  it.each(['knip-baseline.json', '.jscpd-baseline.json', 'eslint-suppressions.json'])(
    'has no %s: every finding fails',
    (file) => {
      expect(
        existsSync(path.join(REPO_ROOT, file)),
        `${file} is a baseline; fix the findings`,
      ).toBe(false);
    },
  );

  it('runs knip and jscpd with nothing that hides a finding', () => {
    const { scripts } = JSON.parse(read('package.json'));

    expect(scripts.knip).not.toMatch(/--preprocessor|--no-exit-code/);
    expect(read('scripts/jscpd.mjs')).not.toMatch(/--baseline|--fail-on-new-clones/);
    expect(JSON.parse(read('.jscpd.json')).threshold).toBe(0);
  });

  // A test that only reads its own package.json repeats what the layout check already holds
  // every workspace to (its name, its domain): it is a test count, not a check.
  it('has no test that only checks its own manifest', () => {
    const tests = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((file) => /\/__tests__\/[^/]+\.test\.[cm]?[jt]s$/.test(file));
    const manifestOnly = tests.filter((file) => {
      const source = read(file);

      return (
        /package\.json/.test(source) &&
        !/^import .* from '\.\.?\//m.test(source) &&
        /toMatchObject\(\{ name:/.test(source)
      );
    });

    expect(manifestOnly, 'The layout check covers a manifest; test the code instead').toEqual([]);
  });
});
