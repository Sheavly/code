import { describe, expect, it } from 'vitest';
import { checkIssueAreas } from '../check-issue-areas.mjs';
import { REPO_ROOT } from './temp-repo.utils.mjs';

/** A stand-in for `gh` over one issue; records the comments it would post. */
function createGh(issue) {
  const posted = [];
  const gh = (args) => {
    if (args[1] === 'view') {
      return JSON.stringify({
        state: issue.state ?? 'OPEN',
        labels: (issue.labels ?? []).map((name) => ({ name })),
        comments: (issue.comments ?? []).map((body) => ({ body })),
      });
    }

    posted.push(args[args.indexOf('--body') + 1]);

    return '';
  };

  return { gh, posted };
}

const check = (gh) => checkIssueAreas({ repoRoot: REPO_ROOT, issue: 33, gh });

describe('issue area check', () => {
  it('passes an open issue with an area label', () => {
    const { gh, posted } = createGh({ labels: ['security', 'area/tooling'] });

    expect(check(gh)).toEqual({ passes: true, commented: false });
    expect(posted).toEqual([]);
  });

  it('passes a closed issue without one', () => {
    expect(check(createGh({ state: 'CLOSED' }).gh).passes).toBe(true);
  });

  it('fails an open issue without an area label and comments with the labels to pick', () => {
    const { gh, posted } = createGh({ labels: ['documentation'] });

    expect(check(gh)).toEqual({ passes: false, commented: true });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('`area/loop`');
    expect(posted[0]).toContain('`area/tooling`');
  });

  it('comments once, not once per event', () => {
    const first = createGh({});

    check(first.gh);

    const later = createGh({ comments: ['Thanks!', ...first.posted] });

    expect(check(later.gh)).toEqual({ passes: false, commented: false });
    expect(later.posted).toEqual([]);
  });
});
