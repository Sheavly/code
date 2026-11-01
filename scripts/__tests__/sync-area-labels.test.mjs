import { afterEach, describe, expect, it } from 'vitest';
import { syncAreaLabels } from '../sync-area-labels.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

/** A stand-in for `gh` over a list of labels and the issues that have them; records its calls. */
function createGh(params) {
  const { labels, issuesByLabel = {} } = params;
  const calls = [];
  const gh = (args) => {
    calls.push(args);

    if (args[0] === 'label' && args[1] === 'list') {
      return JSON.stringify(labels.map((name) => ({ name })));
    }

    if (args[0] === 'issue' && args[1] === 'list') {
      const label = args[args.indexOf('--label') + 1] ?? '';

      return JSON.stringify((issuesByLabel[label] ?? []).map((number) => ({ number })));
    }

    return '';
  };

  return { gh, calls };
}

const createRepo = () =>
  createTempRepo({
    'packages/core/package.json': '{}',
    'src/loop/loop.ts': '',
    'src/testing/fixtures.ts': '',
  });
const IN_STEP = ['area/core', 'area/loop', 'area/tooling', 'security', 'documentation'];

afterEach(removeTempRepos);

describe('area label sync', () => {
  it.each([
    ['the labels match the folders', IN_STEP],
    ['they differ only in case, as GitHub compares them', ['Area/Core', 'area/loop', 'Security']],
  ])('changes nothing when %s', (_case, labels) => {
    const { gh, calls } = createGh({ labels: [...labels, 'area/tooling'] });

    expect(syncAreaLabels({ repoRoot: createRepo(), gh })).toEqual({
      created: [],
      deleted: [],
      kept: [],
    });
    expect(calls).toHaveLength(1);
  });

  it('creates a label for a new folder, with its colour and description', () => {
    const repoRoot = createRepo();
    const { gh, calls } = createGh({ labels: IN_STEP.filter((name) => name !== 'area/loop') });

    expect(syncAreaLabels({ repoRoot, gh }).created).toEqual(['area/loop']);
    expect(calls).toContainEqual([
      'label',
      'create',
      'area/loop',
      '--color',
      '1d76db',
      '--description',
      'Commit scope loop: src/loop',
    ]);
  });

  it('creates the whole set in a repo with none, without src/testing', () => {
    const { gh } = createGh({ labels: [] });

    expect(syncAreaLabels({ repoRoot: createRepo(), gh }).created).toEqual([
      'area/core',
      'area/loop',
      'area/tooling',
      'security',
    ]);
  });

  it('deletes a label whose folder is gone once no open issue has it', () => {
    const { gh, calls } = createGh({ labels: [...IN_STEP, 'area/runtime'] });

    expect(syncAreaLabels({ repoRoot: createRepo(), gh }).deleted).toEqual(['area/runtime']);
    expect(calls).toContainEqual(['label', 'delete', 'area/runtime', '--yes']);
  });

  it('keeps and reports a removed folder whose label is still on an open issue', () => {
    const { gh, calls } = createGh({
      labels: [...IN_STEP, 'area/runtime'],
      issuesByLabel: { 'area/runtime': [7] },
    });

    expect(syncAreaLabels({ repoRoot: createRepo(), gh })).toEqual({
      created: [],
      deleted: [],
      kept: ['area/runtime'],
    });
    expect(calls.some((args) => args[1] === 'delete')).toBe(false);
    expect(calls).toContainEqual(expect.arrayContaining(['--state', 'open']));
  });
});
