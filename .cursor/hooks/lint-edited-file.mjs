// postToolUse (Write, Delete): format the file the agent just edited with Prettier, then lint it
// and hand the problems straight back, so they're fixed while the file is fresh instead of piling
// up until the stop check. The first edit of harness source in a chat (and any edit that breaks
// `harness/no-terminal-io`) also injects the project's architecture rule: backend only, typed
// events, no UI unless the issue asks (architecture.utils.mjs). The first edit of a file a skill
// governs names that skill (skills.utils.mjs), and source outside every workspace's src/ is
// reported (layout.utils.mjs). Every edit or deletion of project
// source is recorded in the chat's state, so the stop hook checks only chats that changed this
// checkout. Advisory: it never blocks the edit. The stop hook (check-on-stop.mjs) enforces.
import { architectureRule, coveredByRule } from './architecture.utils.mjs';
import { HookStateError, ProjectReadError } from './hooks.errors.mjs';
import {
  FORMATTABLE,
  formatEslintReport,
  getChatState,
  getEditedFilePath,
  isProjectSource,
  LINTABLE,
  PROJECT_ROOT,
  readHookInput,
  respond,
  runBin,
  updateChatState,
} from './hooks.utils.mjs';
import { hintGoverningSkills } from './skills.utils.mjs';
import { strayEditNote } from './layout.utils.mjs';
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

// Recorded first, so an edit Prettier or ESLint then fails on still counts.
remember({ editedProjectSource: true });

// A deleted file has nothing left to format or lint; the stop hook checks what it broke.
if (!existsSync(filePath)) {
  respond({});
  process.exit(0);
}

// The architecture rule (backend only, no UI unless an issue asks) is injected the first time a
// chat edits harness source, and again whenever an edit breaks it.
const relative = path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
const ruleShown = readState()?.architectureRuleShown === true;
let ruleBroken = false;

// Formatting is applied, not reported: there's nothing for the agent to decide. It's told, so
// it re-reads the file before editing it again (its copy no longer matches).
if (FORMATTABLE.test(filePath)) {
  const before = runBin('prettier', ['--check', filePath]);

  if (!before.ok && runBin('prettier', ['--write', filePath]).ok) {
    notes.push(
      'Prettier reformatted the file you just edited; re-read it before editing it again.',
    );
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
    remember({ architectureRuleShown: true });
  }
}

// TypeScript outside every workspace's src/ is reported now, not first at the stop check.
const stray = strayEditNote(relative);

if (stray) notes.push(stray);

// The skill that governs this file (its `harness.json` `governs` globs), named once per chat.
try {
  notes.push(...hintGoverningSkills({ conversationId, relative }));
} catch (caughtError) {
  // Advisory: broken skill metadata, or a state write that fails (read-only home, full disk:
  // a Node error with a `code`), is reported in place of the hint and never blocks the edit.
  const expected =
    caughtError instanceof ProjectReadError ||
    caughtError instanceof HookStateError ||
    Boolean(caughtError?.code);

  if (!expected) throw caughtError;

  notes.push(caughtError.message);
}

respond(notes.length > 0 ? { additional_context: notes.join('\n\n') } : {});

/**
 * Advisory: a state write that fails (read-only home, full disk, a corrupt state file) must not
 * lose the notes. The agent is told; the rule is shown again on the next edit, and the stop hook
 * skips a chat it has no record of.
 */
function remember(fields) {
  try {
    updateChatState({ conversationId, ...fields });
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
