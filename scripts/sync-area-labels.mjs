// Keeps the issue labels that say where work lives in step with the commit scopes: one
// `area/<scope>` per workspace in packages/ and apps/ and src/ folder (listScopes, the same source as the commit format),
// plus `area/tooling` and the cross-cutting `security`. Runs on every push to main
// (.github/workflows/sync-labels.yml), so a new folder gets its label when it lands.
//
// Missing labels are created; existing ones are left as they are, so a description edited on
// GitHub stays. An `area/*` label whose folder is gone is deleted once no open issue has it, and
// reported until then, so moving open issues to the new areas is a person's call.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AREA_PREFIX,
  isAreaLabel,
  listAreaLabels,
  TOOLING_AREA,
} from '../.cursor/hooks/git-workflow.utils.mjs';
import { readGhJson, runGh } from './gh.utils.mjs';

// One colour per family: every area label shares one, `security` has its own.
const AREA_COLOR = '1d76db';
const SECURITY_LABEL = {
  name: 'security',
  color: 'b60205',
  description: 'The sandbox, secrets, trust or command isolation; with the area labels it touches',
};

function describeArea(params) {
  const { repoRoot, label } = params;

  if (label === TOOLING_AREA) {
    return 'Work without a commit scope: .cursor/, scripts/, .github/, root configs';
  }

  const scope = label.slice(AREA_PREFIX.length);
  const folder =
    ['packages', 'apps'].find((parent) => existsSync(path.join(repoRoot, parent, scope))) ?? 'src';

  return `Commit scope ${scope}: ${folder}/${scope}`;
}

/** The labels the repo should have: name, colour and the description a new one gets. */
function listExpectedLabels(repoRoot) {
  const areas = listAreaLabels(repoRoot).map((label) => ({
    name: label,
    color: AREA_COLOR,
    description: describeArea({ repoRoot, label }),
  }));

  return [...areas, SECURITY_LABEL];
}

function isOnAnOpenIssue(params) {
  const { gh, label } = params;
  const issues = readGhJson({
    gh,
    args: [
      'issue',
      'list',
      '--label',
      label,
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      'number',
    ],
  });

  return issues.length > 0;
}

/**
 * Creates the missing labels and deletes `area/*` labels whose folder is gone and that no open
 * issue has (deleting a label removes it from the closed issues too). Returns what it `created`
 * and `deleted`, and the stale labels it `kept` because open issues still have them. GitHub
 * compares label names without case, so this does too.
 */
export function syncAreaLabels(params) {
  const { repoRoot, gh = runGh } = params;
  const existing = readGhJson({
    gh,
    args: ['label', 'list', '--limit', '1000', '--json', 'name'],
  }).map((label) => label.name);
  const existingKeys = new Set(existing.map((name) => name.toLowerCase()));
  const expected = listExpectedLabels(repoRoot);
  const missing = expected.filter((label) => !existingKeys.has(label.name.toLowerCase()));

  for (const { name, color, description } of missing) {
    gh(['label', 'create', name, '--color', color, '--description', description]);
  }

  const expectedKeys = new Set(expected.map((label) => label.name.toLowerCase()));
  const stale = existing.filter((name) => {
    const key = name.toLowerCase();

    return isAreaLabel(key) && !expectedKeys.has(key);
  });
  const kept = stale.filter((label) => isOnAnOpenIssue({ gh, label }));
  const deleted = stale.filter((label) => !kept.includes(label));

  for (const label of deleted) gh(['label', 'delete', label, '--yes']);

  return { created: missing.map((label) => label.name), deleted, kept };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { created, deleted, kept } = syncAreaLabels({
    repoRoot: path.resolve(import.meta.dirname, '..'),
  });

  console.log(
    `Created: ${created.join(', ') || 'none'}. Deleted: ${deleted.join(', ') || 'none'}.`,
  );

  // A GitHub Actions warning annotation, shown on the run's summary.
  for (const label of kept) {
    console.log(
      `::warning::${label} names no package or src/ folder any more, but open issues still have it. Move them to the current area labels; the next sync deletes it.`,
    );
  }
}
