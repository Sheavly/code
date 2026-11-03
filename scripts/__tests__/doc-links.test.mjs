import { afterEach, describe, expect, it } from 'vitest';
import { brokenLinkProblems } from '../doc-links.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

describe('links between docs', () => {
  it('fails a link to a missing file or heading, and passes the rest', () => {
    const files = {
      'docs/a.md': '# A\n\n## Workspace trust\n',
      'docs/b.md': [
        '[ok](a.md) [ok](a.md#workspace-trust) [web](https://x.dev) [here](#b)',
        '[gone](gone.md) [no heading](a.md#nope)',
        '```md\n[in code](ignored.md)\n```',
        '# B',
      ].join('\n'),
    };
    const root = createTempRepo(files);

    expect(brokenLinkProblems({ root, files: Object.keys(files) })).toEqual([
      "docs/b.md: links to gone.md, which doesn't exist.",
      'docs/b.md: links to a.md#nope, but a.md has no "#nope" heading.',
    ]);
  });
});
