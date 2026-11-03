import { afterEach, describe, expect, it } from 'vitest';
import {
  areaLabel,
  checkCommitMessage,
  checkHeader,
  findClosingIssues,
  findIssues,
  findPartOfIssues,
  getBranchIssue,
  headerArea,
  isCherryPickApproval,
  isAreaLabel,
  isNoIssuePrompt,
  listAreaLabels,
  listScopes,
} from '../git-workflow.utils.mjs';
import {
  createTempRepo,
  REPO_ROOT,
  removeTempRepos,
} from '../../../scripts/__tests__/temp-repo.utils.mjs';

const SCOPES = ['core', 'loop', 'tools'];

afterEach(removeTempRepos);

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

  it('reads scopes from the packages and apps folders', () => {
    expect(listScopes(REPO_ROOT)).toEqual(
      expect.arrayContaining(['core', 'eslint-config', 'loop', 'testing', 'tools', 'workbook']),
    );
  });

  it('reads each workspace in packages/ and apps/ as a scope, and a folder with no manifest as none', () => {
    const root = createTempRepo({
      'package.json': JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }),
      'apps/cli/package.json': '{}',
      'apps/vscode/README.md': '# not a workspace yet\n',
      'packages/core/package.json': '{}',
    });

    expect(listScopes(root)).toEqual(['cli', 'core']);
  });
});

describe('area labels', () => {
  it('names one per scope, and tooling for a commit without one', () => {
    expect(areaLabel('loop')).toBe('area/loop');
    expect(areaLabel(undefined)).toBe('area/tooling');
    expect(isAreaLabel('Area/Core')).toBe(true);
    expect(isAreaLabel('security')).toBe(false);
    expect(listAreaLabels(REPO_ROOT)).toEqual(
      expect.arrayContaining(['area/core', 'area/eslint-config', 'area/loop', 'area/tooling']),
    );
  });

  it('reads the area a commit header calls for', () => {
    expect(headerArea('feat(loop)!: add x')).toBe('area/loop');
    expect(headerArea('ci: add a workflow')).toBe('area/tooling');
    expect(headerArea('Merge branch main')).toBeNull();
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
