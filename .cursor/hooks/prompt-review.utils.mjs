import { isTestOrFake } from '../../packages/eslint-config/src/test-paths.utils.js';

/** Tool contracts span workspaces; their review failures name the prompt, not the edited tool. */
export function promptReviewFailure(params) {
  const { scope, run } = params;

  if (scope && ![...scope.files].some(needsPromptReview)) return null;

  const result = run('lint:prompt');

  return result.ok ? null : `## System prompt review (\`npm run lint:prompt\`)\n${result.output}`;
}

function needsPromptReview(file) {
  const normalized = file.split('\\').join('/');

  if (isTestOrFake(normalized)) return false;

  return (
    /\.(tool|constants|prompt)\.ts$/.test(normalized) ||
    /(^|\/)package\.json$/.test(normalized) ||
    normalized.startsWith('packages/eslint-config/') ||
    normalized === 'turbo.json' ||
    normalized === '.cursor/hooks/check-on-stop.mjs' ||
    normalized === '.cursor/hooks/prompt-review.utils.mjs'
  );
}
