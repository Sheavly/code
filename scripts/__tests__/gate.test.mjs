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
});
