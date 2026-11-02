// stop: before the agent finishes, run the quality gate (typecheck + ESLint for the affected
// workspaces through turbo, then Prettier + knip + jscpd on the whole repo). If any fails, send a
// follow-up so the agent keeps fixing; Cursor caps the loop with `loop_limit` in hooks.json.
// Problems baselined in eslint-suppressions.json, knip-baseline.json and .jscpd-baseline.json
// don't count; new ones do.
// Once the gate passes, nudge (once per set of files) when source files changed but the doc in
// docs/ that describes them didn't (see docs.utils.mjs).
// Only a chat that changed project source in this checkout (a Write or Delete, recorded by
// lint-edited-file.mjs) is checked, so a chat that only answered questions, worked in another
// worktree or edited only through the shell never gets another chat's half-finished work back as
// failures.
import { onlyNew, staleDocs, uncommittedFiles } from './docs.utils.mjs';
import { HookStateError, ProjectReadError } from './hooks.errors.mjs';
import { RUN_CHECK_KEY, runCheckMessage, runSourceFiles } from './run-check.utils.mjs';
import {
  formatNewClones,
  formatTurboReport,
  getChatState,
  readHookInput,
  respond,
  runBin,
  runNpmScript,
} from './hooks.utils.mjs';

const MAX_REPORT_LINES = 60;

/** The hook's response: `{}`, a gate failure report, or the docs nudge. */
async function decide() {
  const input = await readHookInput();

  // Only a finished turn is checked: an aborted or errored one was stopped on purpose. Only a
  // chat that edited this checkout is checked: the rest would be reporting other chats' work.
  const editedCheckout = getChatState(input.conversation_id)?.editedProjectSource === true;

  if (input.status !== 'completed' || !editedCheckout) return {};

  const failures = runGate();

  if (failures.length === 0) return docsNudge();

  const report = failures.join('\n\n').split('\n').slice(0, MAX_REPORT_LINES).join('\n');

  return {
    followup_message:
      'The quality gate fails. Fix the code (no eslint-disable comments, no new suppressions), ' +
      `then finish again.\n\n${report}`,
  };
}

/** Every gate step; returns a report section for each one that fails. */
function runGate() {
  const failures = [];

  // Typecheck and ESLint per workspace, through turbo: only the workspaces this branch and its
  // uncommitted changes affect, and nothing whose inputs a cached run already passed.
  const workspaces = runBin('turbo', [
    'run',
    ...['typecheck', 'typecheck:root', 'lint', 'lint:root'],
    '--affected',
    '--continue',
    '--output-logs=errors-only',
  ]);

  if (!workspaces.ok) {
    failures.push(`## Typecheck and ESLint (turbo)\n${formatTurboReport(workspaces.output)}`);
  }

  // Repo-wide: always the whole repo.
  const format = runBin('prettier', ['--check', '--log-level', 'warn', '.']);

  if (!format.ok) {
    failures.push(
      `## Prettier (fix with \`npx prettier --write <file>\` or \`npm run format\`)\n${format.output}`,
    );
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

  return failures;
}

// A state file the hook can't read (this chat's, or the docs nudge's) is said, never a silent
// skip: the follow-up names the file, so the agent can tell the user what to fix.
try {
  respond(await decide());
} catch (caughtError) {
  if (!(caughtError instanceof HookStateError || caughtError instanceof ProjectReadError)) {
    throw caughtError;
  }

  respond({
    followup_message: `The stop hook could not run the quality gate: ${caughtError.message}`,
  });
}

/**
 * The follow-ups once the gate passes: docs to update, and a real-model check to run, each asked
 * once per set of files. `{}` when nothing is left to ask.
 */
function docsNudge() {
  const changed = uncommittedFiles();

  if (!changed) return {};

  const messages = [];
  const stale = onlyNew(staleDocs(changed));

  if (stale.length > 0) {
    const list = stale.map(({ doc, files }) => `- ${doc}, for: ${files.join(', ')}`).join('\n');

    messages.push(
      'You changed files that docs/ describes, but not the docs. If what a doc says no longer ' +
        'matches (behavior, APIs, file layout, how to add things), update it now. If nothing it ' +
        `describes changed, just finish: you won't be asked again for these files.\n\n${list}`,
    );
  }

  const runFiles = runSourceFiles(changed);
  const [runCheck] = runFiles.length > 0 ? onlyNew([{ doc: RUN_CHECK_KEY, files: runFiles }]) : [];

  if (runCheck) messages.push(runCheckMessage(runCheck.files));

  return messages.length > 0 ? { followup_message: messages.join('\n\n---\n\n') } : {};
}
