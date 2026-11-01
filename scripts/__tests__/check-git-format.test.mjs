import { describe, expect, it } from 'vitest';
import { findFormatProblems } from '../check-git-format.mjs';
import { REPO_ROOT } from './temp-repo.utils.mjs';

const pr = (fields = {}) =>
  findFormatProblems({
    repoRoot: REPO_ROOT,
    title: 'feat(loop): switch providers between turns',
    body: '## Why\n\nBecause.\n\nCloses #12',
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

    expect(pr({ ...layer, body: 'Stacked on #45.\n\nPart of #12' })).toEqual([]);
    expect(pr({ ...layer, body: 'Closes #12' })).toEqual([]);
    expect(
      pr({ baseRef: '12-switch-contract', headRef: '13-switch-ui', body: 'Closes #13' }),
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
