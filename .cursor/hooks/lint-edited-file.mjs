// postToolUse (Write, Delete): format the file the agent just edited with Prettier, then lint it
// and hand the problems straight back, so they're fixed while the file is fresh instead of piling
// up until the stop check. The first edit of harness source in a chat (and any edit that breaks
// `harness/no-terminal-io`) also injects the project's architecture rule: backend only, typed
// events, no UI unless the issue asks; the first edit also injects "Where code goes" (both from
// the `sheavly` skill's layers guide, architecture.utils.mjs). The first edit of a file a skill governs names that
// skill (skills.utils.mjs), the first edit inside a workspace shows its README
// (workspace-readme.utils.mjs), and source outside every workspace's src/ is reported
// (layout.utils.mjs). Every edit or deletion of project source is recorded in the chat's state, so
// the stop hook checks only chats that changed this checkout. Advisory: it never blocks the edit.
// The stop hook (check-on-stop.mjs) enforces.
import { architectureRule, coveredByRule, whereCodeGoes } from './architecture.utils.mjs';
import { editToolFields } from './chat-files.utils.mjs';
import { linkFromToolCall } from './chat-links.utils.mjs';
import { changeChatState, getChatState } from './chat-state.utils.mjs';
import { SkillMetadataError } from '../../packages/eslint-config/src/skills.errors.js';
import { HookStateError, ProjectReadError } from './hooks.errors.mjs';
import {
  FORMATTABLE,
  getEditedFilePath,
  isProjectSource,
  LINTABLE,
  PROJECT_ROOT,
  readHookInput,
  respond,
  runBin,
} from './hooks.utils.mjs';
import { formatEslintReport } from './lint-report.utils.mjs';
import { hintGoverningSkills } from './skills.utils.mjs';
import { strayEditNote } from './layout.utils.mjs';
import { hintWorkspaceReadme } from './workspace-readme.utils.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';

const input = await readHookInput();
const filePath = getEditedFilePath(input.tool_input);

if (!filePath || !isProjectSource(filePath)) {
  respond({});
  process.exit(0);
}

const notes = [];
const conversationId = input.conversation_id;
const projectFile = path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');

// A subagent's edits are checked by the chat that started it (chat-links.utils.mjs).
linkFromToolCall(input);

// Recorded first, so an edit Prettier or ESLint then fails on still counts. Built from the state
// as it is under the lock: another hook (the shell recorder) writes the same lists.
remember((state) => editToolFields({ state, files: [projectFile] }));

// A deleted file has nothing left to format or lint; the stop hook checks what it broke.
if (!existsSync(filePath)) {
  respond({});
  process.exit(0);
}

// The architecture rule (backend only, no UI unless an issue asks) is injected the first time a
// chat edits harness source, and again whenever an edit breaks it.
const relative = projectFile;
const ruleShown = readState()?.architectureRuleShown === true;
let ruleBroken = false;

// Formatting is applied, not reported: there's nothing for the agent to decide. It's told, so
// it re-reads the file before editing it again (its copy no longer matches).
// With SHEAVLY_FORMAT_CHECK_ONLY set (the Sheavly project hook sets it) it only reports: a rewrite
// after the tool returned would leave the harness's read-before-edit tracking stale.
if (FORMATTABLE.test(filePath)) {
  const before = runBin('prettier', ['--check', filePath]);

  if (!before.ok && process.env.SHEAVLY_FORMAT_CHECK_ONLY) {
    // `runBin` says "Could not run" when Prettier did not start: that is not a formatting problem.
    if (!before.output.startsWith('Could not run')) {
      notes.push(
        'Prettier would reformat the file you just edited. Run `npx prettier --write <file>`, then ' +
          're-read it before editing it again.',
      );
    }
  } else if (!before.ok && runBin('prettier', ['--write', filePath]).ok) {
    notes.push(
      'Prettier reformatted the file you just edited; re-read it before editing it again.',
    );
    // The rewrite is the edit tools' change too, and lands after the stamp above: a shell command
    // started in between would otherwise be blamed for it.
    remember((state) => editToolFields({ state, files: [projectFile] }));
  }
}

if (LINTABLE.test(filePath)) {
  const { ok, output } = runBin('eslint', ['--format', 'json', filePath]);

  if (!ok) {
    const problems = output.startsWith('[') ? formatEslintReport(output) : [output];

    ruleBroken = problems.some((problem) => problem.includes('(harness/no-terminal-io)'));
    notes.push(
      'ESLint found problems in the file you just edited. Fix them in code ' +
        `(inline eslint-disable comments are not allowed in this project):\n${problems.join('\n')}`,
    );
  }
}

if (coveredByRule(relative) && (!ruleShown || ruleBroken)) {
  const rule = architectureRule();

  if (rule) {
    notes.push(rule);
    remember(() => ({ architectureRuleShown: true }));
  }
}

// "Where code goes" once per chat, on its first edit of harness source: before more code lands in
// the wrong package.
if (coveredByRule(relative) && readState()?.whereCodeGoesShown !== true) {
  const guide = whereCodeGoes();

  if (guide) {
    notes.push(guide);
    remember(() => ({ whereCodeGoesShown: true }));
  }
}

// TypeScript outside every workspace's src/ is reported now, not first at the stop check.
advise(() => {
  const stray = strayEditNote(relative);

  return stray ? [stray] : [];
});

// The skill that governs this file (its `harness.json` `governs` globs), named once per chat.
advise(() => hintGoverningSkills({ conversationId, relative }));

// The workspace's README, on the chat's first edit inside it: what it is for and its public API,
// before more code lands there.
advise(() => hintWorkspaceReadme({ conversationId, relative }));

respond(notes.length > 0 ? { additional_context: notes.join('\n\n') } : {});

/**
 * Adds the notes `produce` returns. Advisory: a project file it can't read (a malformed
 * package.json, broken skill metadata) or a state write that fails (read-only home, full disk:
 * a Node error with a `code`) is reported in place of its notes and never blocks the edit.
 */
function advise(produce) {
  try {
    notes.push(...produce());
  } catch (caughtError) {
    const expected =
      caughtError instanceof ProjectReadError ||
      caughtError instanceof SkillMetadataError ||
      caughtError instanceof HookStateError ||
      Boolean(caughtError?.code);

    if (!expected) throw caughtError;

    notes.push(caughtError.message);
  }
}

/**
 * Advisory: a state write that fails (read-only home, full disk, a corrupt state file) must not
 * lose the notes. The agent is told; the rule is shown again on the next edit, and the stop hook
 * skips a chat it has no record of.
 */
function remember(change) {
  try {
    changeChatState({ conversationId, change });
  } catch (caughtError) {
    if (!(caughtError instanceof HookStateError) && !caughtError?.code) throw caughtError;
    notes.push(`This edit could not be recorded in the chat's state: ${caughtError.message}`);
  }
}

/** The chat's state; a corrupt one is reported in the notes and read as none. */
function readState() {
  try {
    return getChatState(conversationId);
  } catch (caughtError) {
    if (!(caughtError instanceof HookStateError)) throw caughtError;
    notes.push(caughtError.message);

    return null;
  }
}
