import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHarnessImpact, findAreaProblems, findFormatProblems } from '../check-git-format.mjs';
import { REPO_ROOT } from './temp-repo.utils.mjs';

const IMPACT = '## Harness impact\n\nnone: a fix inside one file.';

/**
 * Every import of a package (not `node:`, not relative) in `file` and the local files it loads,
 * as `<file> imports <package>`.
 */
function packageImports(file, seen = new Set()) {
  if (seen.has(file)) return [];

  seen.add(file);

  // `import … from`, `export … from`, `import 'x'` and `import('x')`.
  const specifiers = [
    ...readFileSync(file, 'utf8').matchAll(
      /^(?:import|export)\s[^;]*?from\s+'([^']+)'|^import\s+'([^']+)'|\bimport\(\s*'([^']+)'/gms,
    ),
  ].map(([, from, bare, dynamic]) => from ?? bare ?? dynamic);
  const local = specifiers.filter((specifier) => specifier.startsWith('.'));
  const own = specifiers
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
    .map((specifier) => `${path.relative(REPO_ROOT, file)} imports ${specifier}`);

  return [
    ...own,
    ...local.flatMap((specifier) =>
      packageImports(path.resolve(path.dirname(file), specifier), seen),
    ),
  ];
}

describe('the CI job', () => {
  // .github/workflows/git-format.yml runs the check with no `npm ci`, so it may load no package.
  it('runs on Node built-ins alone', () => {
    expect(packageImports(path.join(REPO_ROOT, 'scripts/check-git-format.mjs'))).toEqual([]);
  });
});

const pr = (fields = {}) =>
  findFormatProblems({
    repoRoot: REPO_ROOT,
    title: 'feat(loop): switch providers between turns',
    body: `## Why\n\nBecause.\n\n${IMPACT}\n\nCloses #12`,
    author: 'gustaf',
    baseRef: 'main',
    headRef: '12-provider-switch',
    ...fields,
  });

describe('PR format', () => {
  it('passes a conforming title, body and branch', () => {
    expect(pr()).toEqual([]);
  });

  it('fails a title off the header format', () => {
    expect(pr({ title: 'Provider switching' })[0]).toContain('not `type(scope): subject`');
    expect(pr({ title: 'feat: add switching (#12)' })).toEqual([]);
  });

  it('needs a Closes line naming the branch issue', () => {
    expect(pr({ body: 'Relates to #12' })[0]).toContain('Closes #123');
    expect(pr({ body: 'Closes #13' })[0]).toContain('#12');
    expect(pr({ headRef: 'provider-switch' })[0]).toContain('<issue>-<kebab-name>');
  });

  it('passes a stacked PR: based on the issue branch below, linked with Part of', () => {
    const layer = { baseRef: '12-switch-contract', headRef: '12-switch-loop' };

    expect(pr({ ...layer, body: `Stacked on #45.\n\n${IMPACT}\n\nPart of #12` })).toEqual([]);
    expect(pr({ ...layer, body: `${IMPACT}\n\nCloses #12` })).toEqual([]);
    expect(
      pr({
        baseRef: '12-switch-contract',
        headRef: '13-switch-ui',
        body: `${IMPACT}\n\nCloses #13`,
      }),
    ).toEqual([]);
    expect(pr({ body: 'Part of #13' })[0]).toContain('#12');
  });

  it('fails a base that is neither main nor an issue branch', () => {
    expect(pr({ baseRef: 'develop' })[0]).toContain('based on `develop`');
    expect(pr({ baseRef: 'feature/x' })).toHaveLength(1);
  });

  it("waives the issue for Dependabot's own branches only", () => {
    const bot = { author: 'dependabot[bot]', body: '' };

    expect(pr({ ...bot, title: 'build: bump zod', headRef: 'dependabot/npm/zod-4' })).toEqual([]);
    expect(pr({ ...bot, title: 'Bump zod', headRef: 'dependabot/npm/zod-4' })).toHaveLength(1);
    expect(pr({ ...bot, headRef: 'bump-zod' })).not.toEqual([]);
  });
});

describe('harness impact section', () => {
  const body = (section) =>
    `## Why\n\nBecause.\n\n${section}\n\n## Test plan\n\n- [x] ran\n\nCloses #12`;

  it('passes a list of what enforces each trigger, or none with a reason', () => {
    const coverage =
      '- Required helper: `harness/prefer-helper` rejects bypasses; tests in `packages/eslint-config/src/__tests__/helper.test.js` (commit 3).';

    expect(pr({ body: body(`## Harness impact\n\n${coverage}`) })).toEqual([]);
    expect(pr({ body: body('## Harness impact\n\nnone: a typo fix.') })).toEqual([]);
  });

  it('keeps the published examples valid and the unfilled PR template failing', () => {
    const guide = readFileSync(path.join(REPO_ROOT, '.agents/skills/git/harness.md'), 'utf8');
    const examples = [...guide.matchAll(/```markdown\n([\s\S]*?)```/g)];
    const template = readFileSync(path.join(REPO_ROOT, '.github/pull_request_template.md'), 'utf8');

    expect(examples.length).toBeGreaterThan(0);

    for (const [, example] of examples) {
      expect(checkHarnessImpact(example)).toEqual([]);
    }

    expect(checkHarnessImpact(template)[0]).toContain('is empty');
  });

  it('accepts multiline existing coverage, git check evidence and per-constraint reasons', () => {
    const section = `## Harness impact

- Imports: existing \`harness/imports\` rejects the prohibited dependency;
  tests in \`packages/eslint-config/src/__tests__/imports.test.js\`.
- Reporting: \`scripts/check-git-format.mjs\` rejects missing evidence;
  tests in \`scripts/__tests__/check-git-format.test.mjs\` (commit 2).
- Commands: \`.cursor/hooks/guard-git-workflow.mjs\` rejects invalid staging;
  tests in \`.cursor/hooks/__tests__/git-workflow.test.mjs\`.
- none: a local calculation fix introduces no new coding convention.`;

    expect(pr({ body: body(section).replaceAll('\n', '\r\n') })).toEqual([]);
  });

  it('accepts a project hook in .sheavly/hooks as the guard, with its regression test', () => {
    const entry =
      '- Shell commands: `.sheavly/hooks/shell-guard.mjs` blocks anything but an allow; tests in `scripts/__tests__/sheavly-hooks.test.mjs`.';

    expect(pr({ body: body(`## Harness impact\n\n${entry}`) })).toEqual([]);
  });

  it('does not accept a .sheavly path that is not a hook file, or a hook without a test', () => {
    const notAHook =
      '- `.sheavly/notes.md` documents it; tests in `scripts/__tests__/sheavly-hooks.test.mjs`.';
    const untested = '- `.sheavly/hooks/shell-guard.mjs` blocks it.';

    expect(pr({ body: body(`## Harness impact\n\n${notAHook}`) })[0]).toContain('coverage needs');
    expect(pr({ body: body(`## Harness impact\n\n${untested}`) })[0]).toContain('coverage needs');
  });

  it.each([
    '- Existing checks cover it.',
    '- New rule `harness/x` (commit 3).',
    '- Tested in `scripts/__tests__/reporting.test.mjs`.',
    '- Guidance in `AGENTS.md`; tests in `scripts/__tests__/reporting.test.mjs`.',
    '- `harness/imports` and `imports.test.js`.',
  ])('rejects incomplete or doc-only coverage: %s', (entry) => {
    expect(pr({ body: body(`## Harness impact\n\n${entry}`) })[0]).toContain('coverage needs');
  });

  it('checks every bullet, not just the first coverage reference', () => {
    const valid = '- `harness/imports`; `packages/eslint-config/src/__tests__/imports.test.js`.';

    expect(
      pr({ body: body(`## Harness impact\n\n${valid}\n- Missing enforcement.`) }),
    ).toHaveLength(1);
    expect(pr({ body: body(`## Harness impact\n\n${valid}\n- none`) })[0]).toContain(
      'without a reason',
    );
    expect(
      pr({ body: body(`## Harness impact\n\n${valid}\n- none: a local fix adds no convention.`) }),
    ).toEqual([]);
  });

  it('does not count comment examples, later sections or duplicate sections as coverage', () => {
    const evidence = '- `harness/imports`; `packages/eslint-config/src/__tests__/imports.test.js`.';

    expect(pr({ body: body('<!-- ## Harness impact\n\nnone: example -->') })[0]).toContain(
      'needs a',
    );
    expect(
      pr({ body: body(`## Harness impact\n\n- New rule.\n<!-- ${evidence} -->`) })[0],
    ).toContain('coverage needs');
    expect(
      pr({ body: body(`## Harness impact\n\n- New rule.\n  ## Test plan\n\n${evidence}`) })[0],
    ).toContain('coverage needs');
    expect(
      pr({ body: body(`## Harness impact\n\n${evidence}\n\n## Harness impact\n\nnone: typo.`) })[0],
    ).toContain('exactly one');
  });

  it('rejects unstructured prose and a global none mixed with coverage bullets', () => {
    expect(pr({ body: body('## Harness impact\n\nAll checks pass.') })[0]).toContain(
      'needs coverage bullets',
    );
    expect(pr({ body: body('## Harness impact\n\nnone: typo.\n- Missing check.') })[0]).toContain(
      'needs coverage bullets',
    );
  });

  it('fails a body without the section, with it empty, or none without a reason', () => {
    expect(pr({ body: body('') })[0]).toContain('needs a `## Harness impact` section');
    expect(pr({ body: body('## Harness impact\n\n<!-- fill in -->') })[0]).toContain('is empty');
    expect(pr({ body: body('## Harness impact\n\n-\n') })[0]).toContain('is empty');
    expect(pr({ body: body('## Harness impact\n\nnone') })[0]).toContain('without a reason');
  });

  it("waives it for Dependabot's own branches", () => {
    expect(
      pr({ body: 'Bumps x.', author: 'dependabot[bot]', headRef: 'dependabot/npm/x-1.0.0' }),
    ).toEqual([]);
  });
});

describe('area labels of the PR issue', () => {
  const areas = (labels, headers) => findAreaProblems({ issue: 12, labels, headers });
  const HEADERS = ['feat(core): add the contract', 'feat(loop): switch providers', 'docs: x'];

  it('passes when the issue has a label for every commit scope', () => {
    expect(areas(['area/core', 'area/loop', 'area/tooling', 'security'], HEADERS)).toEqual([]);
    expect(areas(['Area/Core', 'AREA/loop', 'area/Tooling'], HEADERS)).toEqual([]);
  });

  it('names each scope without a label, tooling for a commit without one', () => {
    const [problem] = areas(['area/core'], HEADERS);

    expect(problem).toContain('`area/loop`, `area/tooling`');
    expect(problem).toContain('gh issue edit 12 --add-label area/loop,area/tooling');
  });

  it('ignores a commit off the header format, which the guard reports', () => {
    expect(areas([], ['Merge branch main into 12-x'])).toEqual([]);
  });
});
