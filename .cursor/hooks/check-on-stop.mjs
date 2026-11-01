// stop: before the agent finishes, run the quality gate (typecheck + Prettier + ESLint). If any
// fails, send a follow-up so the agent keeps fixing; Cursor caps the loop with `loop_limit` in
// hooks.json. Problems baselined in eslint-suppressions.json don't count; new ones do.
import { globSync } from 'node:fs';
import { formatEslintReport, readHookInput, respond, runBin } from './hooks.utils.mjs';

const MAX_REPORT_LINES = 60;
const TS_PACKAGE_CONFIGS = globSync('packages/*/tsconfig.json');

const input = await readHookInput();

// Only a finished turn is checked: an aborted or errored one was stopped on purpose.
if (input.status !== 'completed') {
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

if (failures.length === 0) {
  respond({});
  process.exit(0);
}

const report = failures.join('\n\n').split('\n').slice(0, MAX_REPORT_LINES).join('\n');

respond({
  followup_message:
    'The quality gate fails. Fix the code (no eslint-disable comments, no new suppressions), ' +
    `then finish again.\n\n${report}`,
});
