// stop: before the agent finishes, run the quality gate (typecheck + Prettier + ESLint + knip +
// jscpd). If any fails, send a follow-up so the agent keeps fixing; Cursor caps the loop with
// `loop_limit` in hooks.json. Problems baselined in eslint-suppressions.json, knip-baseline.json
// and .jscpd-baseline.json don't count; new ones do.
// Once the gate passes, nudge (once per set of files) when source files changed but the doc in
// docs/ that describes them didn't (see docs.utils.mjs).
// Only a chat that changed project source in this checkout (a Write or Delete, recorded by
// lint-edited-file.mjs) is checked, so a chat that only answered questions, worked in another
// worktree or edited only through the shell never gets another chat's half-finished work back as
// failures.
import { globSync } from 'node:fs';
import { onlyNew, staleDocs, uncommittedFiles } from './docs.utils.mjs';
import {
  formatEslintReport,
  formatNewClones,
  getChatState,
  readHookInput,
  respond,
  runBin,
  runNpmScript,
} from './hooks.utils.mjs';

const MAX_REPORT_LINES = 60;
const TS_PACKAGE_CONFIGS = globSync('packages/*/tsconfig.json');

const input = await readHookInput();

// Only a finished turn is checked: an aborted or errored one was stopped on purpose. Only a chat
// that edited this checkout is checked: the rest would be reporting other chats' work.
const editedCheckout = getChatState(input.conversation_id)?.editedProjectSource === true;

if (input.status !== 'completed' || !editedCheckout) {
  respond({});
  process.exit(0);
}

const failures = [];

// The app, then every TypeScript package (each has its own tsconfig.json).
const projects = ['tsconfig.json', ...TS_PACKAGE_CONFIGS];

for (const project of projects) {
  const typecheck = runBin('tsc', ['--noEmit', '-p', project]);

  if (!typecheck.ok) failures.push(`## Typecheck (tsc -p ${project})\n${typecheck.output}`);
}

const format = runBin('prettier', ['--check', '--log-level', 'warn', '.']);

if (!format.ok) {
  failures.push(
    `## Prettier (fix with \`npx prettier --write <file>\` or \`npm run format\`)\n${format.output}`,
  );
}

const lint = runBin('eslint', ['--format', 'json', '.']);

if (!lint.ok) {
  const problems = lint.output.startsWith('[') ? formatEslintReport(lint.output) : [lint.output];

  failures.push(`## ESLint\n${problems.join('\n')}`);
}

// Dead code and duplication, minus what knip-baseline.json / .jscpd-baseline.json record.
const knip = runNpmScript('knip');

if (!knip.ok) {
  failures.push(
    '## knip (remove the unused code, exports or dependencies; change dependencies with ' +
      `\`npm install|uninstall\`, never by editing package.json)\n${knip.output}`,
  );
}

const jscpd = runNpmScript('jscpd');

if (!jscpd.ok) {
  failures.push(
    `## jscpd (reuse or extract the existing code; no jscpd:ignore comments)\n${formatNewClones(jscpd.output)}`,
  );
}

if (failures.length === 0) {
  respond(docsNudge());
  process.exit(0);
}

const report = failures.join('\n\n').split('\n').slice(0, MAX_REPORT_LINES).join('\n');

respond({
  followup_message:
    'The quality gate fails. Fix the code (no eslint-disable comments, no new suppressions), ' +
    `then finish again.\n\n${report}`,
});

/** A follow-up asking for doc updates, or `{}` when the docs are current (or already asked). */
function docsNudge() {
  const changed = uncommittedFiles();

  if (!changed) return {};

  const stale = onlyNew(staleDocs(changed));

  if (stale.length === 0) return {};

  const list = stale.map(({ doc, files }) => `- ${doc}, for: ${files.join(', ')}`).join('\n');

  return {
    followup_message:
      'You changed files that docs/ describes, but not the docs. If what a doc says no longer ' +
      'matches (behavior, APIs, file layout, how to add things), update it now. If nothing it ' +
      `describes changed, just finish: you won't be asked again for these files.\n\n${list}`,
  };
}
