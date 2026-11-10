import { describe, expect, it } from 'vitest';
import { gitEnv, owningWorktree, parseGitdirFile, parseWorktreePaths } from '../worktrees.utils.js';

describe('parseWorktreePaths', () => {
  it('reads each worktree entry and drops bare ones', () => {
    const output = ['worktree /a', 'HEAD x', 'branch main', '', 'worktree /b', 'bare', ''].join(
      '\0',
    );

    expect(parseWorktreePaths(output)).toEqual(['/a']);
  });

  it('reads nothing from empty output', () => {
    expect(parseWorktreePaths('')).toEqual([]);
  });
});

describe('owningWorktree', () => {
  it('picks the innermost worktree holding the root', () => {
    expect(owningWorktree({ worktrees: ['/r', '/r/nested'], root: '/r/nested/src' })).toBe(
      '/r/nested',
    );
  });

  it('is undefined when none holds the root', () => {
    expect(owningWorktree({ worktrees: ['/x'], root: '/r' })).toBeUndefined();
  });
});

describe('parseGitdirFile', () => {
  it('resolves a relative gitdir against the folder holding the file', () => {
    expect(parseGitdirFile({ content: 'gitdir: ../repo/.git/worktrees/w\n', dir: '/p/w' })).toBe(
      '/p/repo/.git/worktrees/w',
    );
  });

  it('is undefined for a file that is not a gitdir pointer', () => {
    expect(parseGitdirFile({ content: 'nope', dir: '/p' })).toBeUndefined();
  });
});

describe('gitEnv', () => {
  it('keeps only what git needs, never GIT_DIR or keys', () => {
    const env = { PATH: '/bin', HOME: '/h', GIT_DIR: '/evil', ANTHROPIC_API_KEY: 'k' };

    expect(gitEnv(env)).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});
