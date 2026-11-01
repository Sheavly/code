import { describe, expect, it } from 'vitest';
import {
  checkCommitMessage,
  checkHeader,
  findClosingIssues,
  findIssues,
  findPartOfIssues,
  getBranchIssue,
  isCherryPickApproval,
  isNoIssuePrompt,
  listScopes,
} from '../git-workflow.utils.mjs';
import { REPO_ROOT } from '../../../scripts/__tests__/temp-repo.utils.mjs';

const SCOPES = ['core', 'loop', 'tools'];

describe('issues in prompts', () => {
  it.each([
    ['#12: add export', [12]],
    ['work on (#7) please', [7]],
    ['https://github.com/o/r/issues/45', [45]],
    ['a stack: #12, #13 and #14 (#12 first)', [12, 13, 14]],
  ])('finds the issues in %j', (prompt, issues) => {
    expect(findIssues(prompt)).toEqual(issues);
  });

  it.each(['add export', 'color #fff', 'PROJ-12: add export', 'abc#12'])(
    'finds none in %j',
    (prompt) => {
      expect(findIssues(prompt)).toEqual([]);
    },
  );

  it('recognises NO-ISSUE only at the start, and the cherry-pick approval', () => {
    expect(isNoIssuePrompt('  no-issue fix a typo')).toBe(true);
    expect(isNoIssuePrompt('fix NO-ISSUE')).toBe(false);
    expect(isCherryPickApproval('ok, allow cherry-pick')).toBe(true);
    expect(isCherryPickApproval('cherry-pick it')).toBe(false);
  });
});

describe('branch names', () => {
  it.each([
    ['123-road-segment-export', 123],
    ['7-x', 7],
  ])('reads the issue of %s', (name, issue) => {
    expect(getBranchIssue(name)).toBe(issue);
  });

  it.each([
    'road-export',
    '123/export',
    '#123-export',
    '123-Export',
    'feature/123-export',
    'PROJ-123/export',
    '123-',
  ])('rejects %s', (name) => {
    expect(getBranchIssue(name)).toBeNull();
  });
});

describe('headers', () => {
  it('accepts a conforming header, with or without a scope or breaking mark', () => {
    for (const header of ['feat(tools): add edit_file', 'chore: add the guard', 'feat(core)!: x']) {
      expect(checkHeader({ header, scopes: SCOPES })).toEqual([]);
    }
  });

  it('names every problem', () => {
    const problems = checkHeader({ header: 'wip(api): Add export.', scopes: SCOPES });

    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toMatch(/type `wip`.*scope `api`.*capital.*full stop/);
    expect(checkHeader({ header: 'Fixed stuff', scopes: SCOPES })[0]).toContain('not `type');
    expect(checkHeader({ header: `fix: ${'a'.repeat(70)}`, scopes: SCOPES })[0]).toContain('72');
  });

  it('reads scopes from the packages and src/ folders, without testing', () => {
    const scopes = listScopes(REPO_ROOT);

    expect(scopes).toEqual(expect.arrayContaining(['core', 'eslint-config', 'loop', 'tools']));
    expect(scopes).not.toContain('testing');
  });
});

describe('commit messages', () => {
  const check = (message, issue = 12) =>
    checkCommitMessage({ message, scopes: SCOPES, issue, issueSource: 'branch 12-x' });

  it('needs a Refs: #n trailer naming the branch issue', () => {
    expect(check('feat(loop): add x\n\nRefs: #12')).toEqual([]);
    expect(check('feat(loop): add x')).toEqual([expect.stringContaining('no `Refs: #123`')]);
    expect(check('feat(loop): add x\n\nRefs: #13')).toEqual([expect.stringContaining('#12')]);
    expect(check('feat(loop): add x\n\nRefs: #13', null)).toEqual([]);
    expect(check('feat(loop): add x\n\nRefs: PROJ-12')[0]).toContain('no `Refs');
  });
});

describe('closing lines', () => {
  it('reads Closes/Fixes/Resolves lines, not mentions', () => {
    expect(findClosingIssues('Why\n\nCloses #12\nfixes #3')).toEqual([12, 3]);
    expect(findClosingIssues('This closes #12 eventually')).toEqual([]);
  });

  it('reads Part of lines, which link a stack layer without closing', () => {
    expect(findPartOfIssues('Stacked on #45.\n\nPart of #12')).toEqual([12]);
    expect(findClosingIssues('Part of #12')).toEqual([]);
    expect(findPartOfIssues('this is part of #12')).toEqual([]);
  });
});
