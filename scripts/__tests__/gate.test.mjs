import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  it('always runs prompt review outside affected-workspace filtering and caching', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const turbo = JSON.parse(read('turbo.json').replace(/^\s*\/\/.*$/gm, ''));
    const reviewStep = scripts['check:repo'];

    expect(scripts['check:affected']).toMatch(/&& npm run check:repo$/);
    expect(scripts.check).toContain('lint:prompt');
    expect(reviewStep).toContain('turbo run lint:prompt');
    expect(reviewStep).not.toMatch(/--affected|--filter/);
    expect(turbo.tasks['//#lint:prompt']).toEqual({ cache: false, outputs: [] });
    expect(scripts['lint:prompt']).toBe(
      'npm exec -w @sheavly/host -- eslint src/instructions/instructions.prompt.ts',
    );
    expect(scripts['lint:prompt']).not.toContain('--cache');
  });

  // `typecheck` compiles with each workspace's `tsconfig.json`, the build with its
  // `tsconfig.build.json`, whose file list differs (it leaves out tests and fakes): a change can pass
  // the first and break the second, and nothing else ran the build.
  it('runs the build, in the gate and in the typecheck group', () => {
    const { scripts } = JSON.parse(read('package.json'));

    expect(scripts.check).toMatch(/^turbo run (?:\S+ )*build(?: |$)/);
    expect(scripts['check:typecheck']).toMatch(/^turbo run typecheck build$/);
    expect(scripts['check:affected']).toMatch(/^turbo run (?:\S+ )*build(?: |$)/);
  });

  // The Check workflow runs these groups as parallel jobs; together they must be `npm run check`.
  it('splits into CI groups that run every task of `npm run check`', () => {
    const { scripts } = JSON.parse(read('package.json'));
    const GROUPS = [
      'check:typecheck',
      'check:lint',
      'check:test',
      'check:eslint-config',
      'check:root',
      'check:repo',
    ];
    // The tasks a script runs, without the turbo filters that only choose which workspaces.
    const tasksOf = (script) =>
      script
        .replace(/^turbo run /, '')
        .replace(/ --(filter=\S+|affected)/g, '')
        .split(/\s+/);
    const grouped = new Set(GROUPS.flatMap((name) => tasksOf(scripts[name])));
    const workflow = read('.github/workflows/check.yml');

    expect([...grouped].sort()).toEqual([...new Set(tasksOf(scripts.check))].sort());
    // The two test groups split the workspaces between them: one has eslint-config, one the rest.
    expect(scripts['check:eslint-config']).toBe('turbo run test --filter=@sheavly/eslint-config');
    expect(scripts['check:test']).toBe('turbo run test --filter=!@sheavly/eslint-config');

    // A task in two groups would run twice; only `test` is, as the two filters split it.
    const everyTask = GROUPS.flatMap((name) => tasksOf(scripts[name]));
    const twice = everyTask.filter((task, i) => everyTask.indexOf(task) !== i);

    expect(twice).toEqual(['test']);

    // Any other group with a filter would silently skip workspaces.
    for (const name of ['check:typecheck', 'check:lint', 'check:root', 'check:repo']) {
      expect(scripts[name], `${name} must not filter workspaces`).not.toContain('--filter');
    }

    // The repo-wide checks are never filtered, by a script flag any more than by the matrix.
    expect(scripts['check:repo']).not.toContain('--affected');

    // `check:affected` is the local form of the same gate: the same tasks, filtered.
    const [filtered] = scripts['check:affected'].split('&&');

    expect(new Set(tasksOf(filtered.trim()))).toEqual(
      new Set(GROUPS.filter((name) => name !== 'check:repo').flatMap((n) => tasksOf(scripts[n]))),
    );

    const live = workflow.replace(/^\s*#.*$/gm, '');

    // Only the repo-wide group runs unfiltered; the others are filtered on a PR.
    expect(live).toMatch(/script: check:repo\n\s+affected: false/);

    for (const name of GROUPS.filter((group) => group !== 'check:repo')) {
      expect(live).toMatch(new RegExp(`script: ${name}\n\\s+affected: true`));
    }

    // Full history on a PR for `--affected`; strings, as a number 0 is falsy and `&& 0 || 1` is 1.
    expect(live).toContain("fetch-depth: ${{ github.event_name == 'pull_request' && '0' || '1' }}");
    // Without a base, turbo warns "unable to detect git range" and `--affected` runs everything.
    // The base comes in through env, never through the script text.
    expect(live).toContain(
      "TURBO_SCM_BASE: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || '' }}",
    );
    // The turbo summary lives in the hidden `.turbo` folder, which upload-artifact skips unless
    // told otherwise; without this the diagnostic would silently upload nothing.
    expect(live).toContain("TURBO_RUN_SUMMARY: 'true'");
    expect(live).toContain('path: .turbo/runs');
    expect(live).toContain('include-hidden-files: true');
    // An artifact name may not contain a colon, which every `matrix.script` has.
    expect(live).toContain('name: turbo-summary-${{ matrix.name }}');
    // `npm ci` always runs, without the audit and fund network calls that made it take 48s instead
    // of 6s. `node_modules` itself is not cached: it would save 6s and add a cache to keep clean.
    expect(live).toMatch(/name: Install\n\s+run: npm ci --no-audit --no-fund\n/);
    expect(live).not.toContain('actions/cache/save');
    expect(live).not.toMatch(/^\s+(?:path: \|?\s*)?\S*node_modules\S*$/m);

    // Every action is pinned to a full commit SHA, in every workflow. Local (`./`) actions have no
    // ref to pin.
    for (const file of readdirSync(path.join(REPO_ROOT, '.github/workflows'))) {
      const uses = read(`.github/workflows/${file}`).match(/^\s*(?:- )?uses: \S+/gm) ?? [];

      for (const line of uses.filter((entry) => !entry.includes('uses: ./'))) {
        expect(line, `${file} must pin actions to a commit SHA`).toMatch(/@[0-9a-f]{40}$/);
      }
    }

    // Exactly one entry per group, so a duplicate unfiltered or filtered one can't slip in.
    expect(live.match(/^\s+script: /gm)).toHaveLength(GROUPS.length);
    // The whole step line: filtered only on a PR, so a push to main runs (and caches) every task.
    expect(live).toContain(
      "run: npm run ${{ matrix.script }}${{ matrix.affected && github.event_name == 'pull_request' && ' -- --affected' || '' }}",
    );
  });

  it('connects the independent prompt check to the stop gate without report scoping', () => {
    const hook = read('.cursor/hooks/check-on-stop.mjs');

    expect(hook).toContain('promptReviewFailure({ scope, run: runNpmScript })');
    expect(hook).toContain('if (promptFailure) failures.push(promptFailure)');
    expect(hook).not.toContain('scoped(promptFailure)');
  });

  // A test that only reads its own package.json repeats what the layout check already holds
  // every workspace to (its name, its domain): it is a test count, not a check.
  it('has no test that only checks its own manifest', () => {
    const tests = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      // Git's index includes unstaged deletions; only existing tests can contain manifest checks.
      .filter(
        (file) =>
          /\/__tests__\/[^/]+\.test\.[cm]?[jt]s$/.test(file) &&
          existsSync(path.join(REPO_ROOT, file)),
      );
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
