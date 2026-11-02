import { describe, expect, it } from 'vitest';
import { findAreaProblems, findFormatProblems } from '../check-git-format.mjs';
import { REPO_ROOT } from './temp-repo.utils.mjs';

const IMPACT = '## Harness impact\n\nnone: a fix inside one file.';

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
    expect(pr({ body: body('## Harness impact\n\n- New rule `harness/x` (commit 3).') })).toEqual(
      [],
    );
    expect(pr({ body: body('## Harness impact\n\nnone: a typo fix.') })).toEqual([]);
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
