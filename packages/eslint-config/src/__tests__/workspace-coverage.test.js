// Every workspace gets the harness rules, so a new package can't skip them. The shared config is
// the source of truth: whatever `baseConfig` enables in a synthetic workspace (named like nothing
// in this repo) must be enabled in every real one, on a module file at a path no workspace
// special-cases. Each workspace also needs the scripts turbo runs, since turbo silently skips a
// workspace without one. The workspaces are read from the root `package.json`, never listed here.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { workspaceDirs } from '../rules/workspace-types.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const BASE_CONFIG = pathToFileURL(path.join(import.meta.dirname, '..', 'base.js')).href;
/** A module file of a kind every rule applies to, in a folder no workspace special-cases. */
const PROBE = 'src/zz-probe/zz-probe.utils.ts';
const REQUIRED_SCRIPTS = ['typecheck', 'lint', 'test'];
/** Scripts a workspace may lack, with why. Keep it short. */
const MISSING_SCRIPT_EXCEPTIONS = {
  // The app is the root package: turbo runs its `typecheck:root`, `lint:root` and `test:root`.
  '.': ['typecheck', 'lint', 'test'],
};

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function enabledRules(dir) {
  const config = await new ESLint({ cwd: dir }).calculateConfigForFile(path.join(dir, PROBE));
  const severity = (entry) => (Array.isArray(entry) ? entry[0] : entry);

  return Object.entries(config?.rules ?? {})
    .filter(([, entry]) => ![0, 'off'].includes(severity(entry)))
    .map(([rule]) => rule)
    .sort();
}

/**
 * A workspace that only calls `baseConfig`: what every workspace gets at the least. A test-only
 * one (`sheavly.testOnly`, like `@sheavly/testing`) has the test rules on all its source; an app
 * may read env, print and use the terminal.
 */
async function baselineRules(params = {}) {
  const { testOnly = false, app = false } = params;
  const parent = mkdtempSync(path.join(tmpdir(), 'zz-synthetic-workspace-'));
  // An app is a workspace in an `apps/` folder: baseConfig reads that from where it is.
  const dir = path.join(parent, app ? 'apps' : 'packages', 'zz');

  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'zz', sheavly: { testOnly } }),
  );
  writeFileSync(
    path.join(dir, 'eslint.config.js'),
    `import { baseConfig } from '${BASE_CONFIG}';\n\nexport default baseConfig({ tsconfigRootDir: import.meta.dirname });\n`,
  );

  return enabledRules(dir);
}

const isTestOnly = (dir) => readJson(path.join(dir, 'package.json')).sheavly?.testOnly === true;
const isApp = (dir) => path.basename(path.dirname(dir)) === 'apps';
const WORKSPACES = workspaceDirs(REPO_ROOT);
const BASELINE = await baselineRules();
const TEST_ONLY_BASELINE = await baselineRules({ testOnly: true });
const APP_BASELINE = await baselineRules({ app: true });

/** What a workspace of this kind gets from the shared config alone. */
function baselineFor(dir) {
  if (isTestOnly(dir)) return TEST_ONLY_BASELINE;

  return isApp(dir) ? APP_BASELINE : BASELINE;
}

it('reads the app and at least one package from the root workspaces', () => {
  expect(WORKSPACES).toContain(REPO_ROOT);
  expect(WORKSPACES.length).toBeGreaterThan(1);
});

it('lets an app, and only an app, read env, print and use the terminal', () => {
  const offInApps = ['harness/no-process-env', 'harness/no-terminal-io', 'no-console'];

  expect(BASELINE).toEqual(expect.arrayContaining(offInApps));
  expect(APP_BASELINE.filter((rule) => offInApps.includes(rule))).toEqual([]);
});

it('gets the harness rules from the shared config alone', () => {
  expect(BASELINE).toEqual(
    expect.arrayContaining([
      'harness/file-kind',
      'harness/kind-contents',
      'harness/pure-imports',
      'harness/single-definition',
      'harness/layout',
      'harness/imports',
      'harness/no-raw-error',
      'harness/no-silent-catch',
    ]),
  );
});

describe.each(WORKSPACES.map((dir) => [path.relative(REPO_ROOT, dir) || '.', dir]))(
  '%s',
  (name, dir) => {
    it('has an eslint.config.js', () => {
      expect(
        existsSync(path.join(dir, 'eslint.config.js')),
        'Add one calling `baseConfig({ tsconfigRootDir: import.meta.dirname })` from @sheavly/eslint-config.',
      ).toBe(true);
    });

    it('enables every rule the shared config does', async () => {
      const enabled = new Set(await enabledRules(dir));

      expect(
        baselineFor(dir).filter((rule) => !enabled.has(rule)),
        `${name} turns off shared rules. Keep them on; a justified exception is a files: override with a reason, on the files it is for.`,
      ).toEqual([]);
    });

    it('has the scripts turbo runs', () => {
      const scripts = readJson(path.join(dir, 'package.json')).scripts ?? {};
      const allowed = MISSING_SCRIPT_EXCEPTIONS[name] ?? [];

      expect(
        REQUIRED_SCRIPTS.filter((script) => !scripts[script] && !allowed.includes(script)),
        'Add them like the other packages (`tsc --noEmit`, `eslint .`, `vitest run --config ../../vitest.config.ts`).',
      ).toEqual([]);
    });
  },
);
