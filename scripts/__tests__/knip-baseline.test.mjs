import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempRepo, REPO_ROOT, removeTempRepos } from './temp-repo.utils.mjs';

// The preprocessor resolves knip-baseline.json next to its own folder, so each temp repo gets
// a copy in scripts/ and its own baseline file.
const PREPROCESSOR = readFileSync(path.join(REPO_ROOT, 'scripts', 'knip-baseline.mjs'), 'utf8');
const UNUSED_EXPORT = 'exports::src/lib.ts::unused';
const KNIP_TIMEOUT_MS = 30_000;

function createKnipRepo(baseline) {
  return createTempRepo({
    'package.json': JSON.stringify({ name: 'knip-fixture', type: 'module', private: true }),
    'knip.json': JSON.stringify({ entry: ['src/index.ts'], project: ['src/**/*.ts'] }),
    'src/index.ts': "import { used } from './lib.js';\n\nexport const value = used;\n",
    'src/lib.ts': 'export const used = 1;\nexport const unused = 2;\n',
    'scripts/knip-baseline.mjs': PREPROCESSOR,
    ...(baseline ? { 'knip-baseline.json': JSON.stringify(baseline) } : {}),
  });
}

/** knip in `root` through the copied preprocessor; `script` stands in for the npm script name. */
function runKnip(params) {
  const { root, script = 'knip' } = params;
  const args = ['--preprocessor', './scripts/knip-baseline.mjs', '--no-progress'];
  const run = spawnSync(
    path.join(root, 'node_modules', '.bin', 'knip'),
    script === 'knip:baseline' ? [...args, '--no-exit-code'] : args,
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_lifecycle_event: script },
    },
  );

  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function readBaseline(root) {
  return JSON.parse(readFileSync(path.join(root, 'knip-baseline.json'), 'utf8'));
}

afterEach(removeTempRepos);

describe('knip baseline', { timeout: KNIP_TIMEOUT_MS }, () => {
  it('fails on a finding that is not baselined', () => {
    const { status, output } = runKnip({ root: createKnipRepo() });

    expect(status).not.toBe(0);
    expect(output).toContain('unused');
  });

  it('drops baselined findings from the report', () => {
    const { status, output } = runKnip({ root: createKnipRepo([UNUSED_EXPORT]) });

    expect(status).toBe(0);
    expect(output).not.toContain('src/lib.ts');
  });

  it('fails on a stale entry for debt that was fixed', () => {
    const stale = 'exports::src/gone.ts::removed';
    const { status, output } = runKnip({ root: createKnipRepo([UNUSED_EXPORT, stale]) });

    expect(status).not.toBe(0);
    expect(output).toContain(stale);
  });

  it('prunes stale entries and keeps live ones', () => {
    const root = createKnipRepo([UNUSED_EXPORT, 'exports::src/gone.ts::removed']);

    expect(runKnip({ root, script: 'knip:baseline' }).status).toBe(0);
    expect(readBaseline(root)).toEqual([UNUSED_EXPORT]);
  });

  it('never adds a new finding when pruning, and fails on it', () => {
    const root = createKnipRepo([]);
    const { status, output } = runKnip({ root, script: 'knip:baseline' });

    expect(status).not.toBe(0);
    expect(output).toContain(UNUSED_EXPORT);
    expect(readBaseline(root)).toEqual([]);
  });
});
