// Every open issue says where its work lives with at least one `area/*` label (one per commit
// scope its PR will have; .cursor/skills/git/issues.md, "Classify"). Runs on issue events
// (.github/workflows/issue-labels.yml) and fails while an open issue has none. It reads the
// issue's labels and comments as they are now, not from the event, so the last of a burst of
// label events decides, and it comments once: a later run finds its marker and stays quiet.
//
// Reads ISSUE_NUMBER from the environment.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAreaLabel, listAreaLabels } from '../.cursor/hooks/git-workflow.utils.mjs';
import { readGhJson, runGh } from './gh.utils.mjs';

const MARKER = '<!-- area-label-check -->';

function writeComment(repoRoot) {
  const labels = listAreaLabels(repoRoot)
    .map((label) => `\`${label}\``)
    .join(', ');

  return `${MARKER}\nThis issue has no area label. Add one \`area/*\` label per commit scope its PR will have (\`area/tooling\` for work without a scope): ${labels}. They come from the packages and \`src/\` folders; see \`.cursor/skills/git/issues.md\` ("Classify").`;
}

/**
 * Whether an issue passes: closed, or open with an area label. When it fails, comments unless
 * an earlier run already did. Returns `{ passes, commented }`.
 */
export function checkIssueAreas(params) {
  const { repoRoot, issue, gh = runGh } = params;
  const { state, labels, comments } = readGhJson({
    gh,
    args: ['issue', 'view', String(issue), '--json', 'state,labels,comments'],
  });

  if (state !== 'OPEN' || labels.some((label) => isAreaLabel(label.name))) {
    return { passes: true, commented: false };
  }

  if (comments.some((comment) => comment.body.includes(MARKER))) {
    return { passes: false, commented: false };
  }

  gh(['issue', 'comment', String(issue), '--body', writeComment(repoRoot)]);

  return { passes: false, commented: true };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const issue = Number(process.env.ISSUE_NUMBER);

  if (!Number.isInteger(issue) || issue <= 0) {
    throw new Error('ISSUE_NUMBER is not set; this check runs on issues events.');
  }

  const { passes } = checkIssueAreas({ repoRoot: path.resolve(import.meta.dirname, '..'), issue });

  if (!passes) {
    console.error(`#${issue} is open without an area/* label.`);
    process.exit(1);
  }

  console.log(`#${issue} has its area labels, or is closed.`);
}
