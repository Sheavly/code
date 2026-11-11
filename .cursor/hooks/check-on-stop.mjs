// stop: before the agent finishes, run the quality gate (typecheck + ESLint through turbo, then
// Prettier + knip + the layout check + jscpd), held to what this chat edited. If any fails, send a
// follow-up so the agent keeps fixing; Cursor caps the loop with `loop_limit` in hooks.json.
// Once the gate passes, nudge (once per set of files) when a workspace's source changed but its
// README and docs/ didn't (see docs.utils.mjs).
// Only a chat that changed project source in this checkout (a Write or Delete, recorded by
// lint-edited-file.mjs, or a shell command's changes, recorded by record-shell-writes.mjs) is
// checked, so a chat that only answered questions or worked in another worktree never gets
// another chat's half-finished work back as failures. A subagent's edits are its parent's to
// check: the parent's stop hook waits while one still works, then checks what the chat and every
// subagent below it edited (chat-links.utils.mjs, subagents.utils.mjs). Several chats can share
// the checkout, so the gate reports only problems in those files and the workspaces they affect
// (gate-scope.utils.mjs); a chat recorded before its files were kept gets the whole gate. A shell
// workaround the chat used must also be learned by the shell guard (shell-guard-stop.utils.mjs).
import { existsSync } from 'node:fs';
import { filesOtherChatsEdited } from './chat-files.utils.mjs';
import { familyWork } from './chat-links.utils.mjs';
import { onlyNew, staleDocs, uncommittedFiles } from './docs.utils.mjs';
import {
  gateScope,
  scopedFiles,
  scopedCloneReport,
  scopedReport,
  scopedTurboReport,
  turboFilters,
} from './gate-scope.utils.mjs';
import { HookStateError, isMissingPath, ProjectReadError } from './hooks.errors.mjs';
import { promptReviewFailure } from './prompt-review.utils.mjs';
import { RUN_CHECK_KEY, runCheckMessage, runSourceFiles } from './run-check.utils.mjs';
import { shellGuardFailure } from './shell-guard-stop.utils.mjs';
import { snapshotProject } from './shell-writes.utils.mjs';
import { dropTimedOutSubagents, findOpenSubagents } from './subagents.utils.mjs';
import {
  FORMATTABLE,
  formatTurboReport,
  PROJECT_ROOT,
  readHookInput,
  respond,
  runBin,
  runNpmScript,
} from './hooks.utils.mjs';

const MAX_REPORT_LINES = 60;

/** The hook's response: `{}`, a gate failure report, or the docs nudge. */
async function decide() {
  const input = await readHookInput();
  const conversationId = input.conversation_id;

  // Only a finished turn is checked: an aborted or errored one was stopped on purpose.
  if (input.status !== 'completed') return {};

  // While a subagent below this chat still works, its edits are half done: the checks wait for
  // the first turn end after the last one stopped. One silent past the timeout no longer holds
  // them back, and is named once (subagents.utils.mjs).
  const { running, timedOut } = findOpenSubagents({ conversationId });

  if (running.length > 0) return {};
  const silent = dropTimedOutSubagents(timedOut);

  // Only a chat that (itself or through its subagents) edited this checkout is checked: the rest
  // would be reporting other chats' work.
  const work = familyWork(conversationId);

  if (!work.edited) return silent ? { followup_message: silent } : {};

  const shellGuard = await shellGuardFailure({
    projectRoot: PROJECT_ROOT,
    conversationId,
    unguardedCommands: work.unguardedCommands,
  });
  const scope = chatScope(work);
  const failures = [...(shellGuard ? [shellGuard] : []), ...runGate(scope)];

  if (failures.length === 0) return docsNudge({ scope, silent });
  if (silent) failures.push(silent);

  const report = failures.join('\n\n').split('\n').slice(0, MAX_REPORT_LINES).join('\n');
  const scopeNote = scope
    ? "Only problems in the files this chat and its subagents edited, and the workspaces they affect, are listed: other chats' work in this checkout is theirs to check.\n\n"
    : '';

  return {
    followup_message:
      'The quality gate fails. Fix the code (no eslint-disable comments, no new suppressions), ' +
      `then finish again.\n\n${scopeNote}${report}`,
  };
}

/**
 * What this chat and its subagents answer for (gate-scope.utils.mjs), or null when one of them
 * edited before files were recorded.
 */
function chatScope(work) {
  if (!work.files) return null;
  const dirty = new Set(Object.keys(snapshotProject(PROJECT_ROOT)?.files ?? {}));
  const othersEdited = filesOtherChatsEdited({ exclude: work.ids, since: 0 });

  try {
    return gateScope({ root: PROJECT_ROOT, files: work.files, dirty, othersEdited });
  } catch (caughtError) {
    // Without the workspaces the gate can't tell this chat's work from another's: said, not guessed.
    if (!isMissingPath(caughtError) && !(caughtError instanceof SyntaxError)) throw caughtError;
    throw new ProjectReadError({ file: 'the workspaces (package.json)', cause: caughtError });
  }
}

const isFormattableFile = (file) => FORMATTABLE.test(file) && existsSync(file);

/** Cached checks for this chat's affected workspaces; prompt review runs separately. */
function workspaceGateFailure(scope) {
  const filters = scope ? turboFilters(scope) : ['--affected'];
  const workspaces =
    filters.length > 0
      ? runBin('turbo', [
          'run',
          ...['typecheck', 'lint', 'lint:root'],
          ...filters,
          '--continue',
          '--output-logs=errors-only',
        ])
      : { ok: true };
  const report = workspaces.ok ? null : formatTurboReport(workspaces.output);

  return report && scope ? scopedTurboReport({ report, scope }) : report;
}

/** Every gate step; returns a report section for each one that fails within `scope`. */
function runGate(scope) {
  const failures = [];
  // A report cut to the scope, or the whole one for a chat recorded before files were kept.
  const scoped = (output, cut = scopedReport) =>
    scope ? cut({ output, scope, root: PROJECT_ROOT }) : output;

  const turboFailure = workspaceGateFailure(scope);

  if (turboFailure) failures.push(`## Typecheck and ESLint (turbo)\n${turboFailure}`);

  // A tool-only edit need not schedule host lint; don't scope away the prompt anchor's error.
  const promptFailure = promptReviewFailure({ scope, run: runNpmScript });

  if (promptFailure) failures.push(promptFailure);

  // Formatting: the files this chat edited (or, unscoped, the whole repo).
  const formattable = scope ? [...scope.files].filter(isFormattableFile) : ['.'];
  const format =
    formattable.length > 0
      ? runBin('prettier', ['--check', '--log-level', 'warn', '--ignore-unknown', ...formattable])
      : { ok: true };

  if (!format.ok) {
    failures.push(
      `## Prettier (fix with \`npx prettier --write <file>\` or \`npm run format\`)\n${format.output}`,
    );
  }

  // Dead code and duplication: any finding fails, there is no baseline.
  const knip = runNpmScript('knip');
  const knipFailure = knip.ok ? null : scoped(knip.output);

  if (knipFailure) {
    failures.push(
      '## knip (remove the unused code, exports or dependencies; change dependencies with ' +
        `\`npm install|uninstall\`, never by editing package.json)\n${knipFailure}`,
    );
  }

  // The workspace layout: every workspace set up like the others, source only in a workspace.
  const layout = runNpmScript('layout');
  const layoutFailure = layout.ok ? null : scoped(layout.output);

  if (layoutFailure) {
    failures.push(
      `## Layout (\`npm run layout\`; see the README's "Workspace layout")\n${layoutFailure}`,
    );
  }

  const jscpd = runNpmScript('jscpd');
  const jscpdFailure = jscpd.ok ? null : scoped(jscpd.output, scopedCloneReport);

  if (jscpdFailure) {
    failures.push(
      `## jscpd (reuse or extract the existing code; no jscpd:ignore comments)\n${jscpdFailure}`,
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
 * once per set of files, for the uncommitted files this chat edited (all of them, unscoped).
 * `{}` when nothing is left to ask.
 */
function docsNudge(params) {
  const { scope, silent } = params;
  const changed = scopedFiles({ files: uncommittedFiles(), scope });
  const messages = silent ? [silent] : [];

  if (!changed?.length) return messages.length > 0 ? { followup_message: silent } : {};

  const stale = onlyNew(staleDocs(changed));

  if (stale.length > 0) {
    const list = stale
      .map(({ doc, files }) => `- ${doc} (and its docs/), for: ${files.join(', ')}`)
      .join('\n');

    messages.push(
      "You changed a workspace's source but neither its README nor its docs/. The README is the " +
        'first place someone looks (what it is for, its public API, an example); docs/ goes deeper. ' +
        'If what they say no longer matches (behavior, APIs, layout, how to add things), update ' +
        "them now. If nothing they describe changed, just finish: you won't be asked again for " +
        `these files.\n\n${list}`,
    );
  }

  const runFiles = runSourceFiles(changed);
  const [runCheck] = runFiles.length > 0 ? onlyNew([{ doc: RUN_CHECK_KEY, files: runFiles }]) : [];

  if (runCheck) messages.push(runCheckMessage(runCheck.files));

  return messages.length > 0 ? { followup_message: messages.join('\n\n---\n\n') } : {};
}
