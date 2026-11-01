// postToolUse (Write): format the file the agent just edited with Prettier, then lint it and hand
// the problems straight back, so they're fixed while the file is fresh instead of piling up
// until the stop check. The first edit of harness source in a chat (and any edit that breaks
// `harness/no-terminal-io`) also injects the project's architecture rule: backend only, typed
// events, no UI unless the issue asks (architecture.utils.mjs). Advisory: it never blocks the
// edit. The stop hook (check-on-stop.mjs) enforces.
import { architectureRule, coveredByRule } from './architecture.utils.mjs';
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
import path from 'node:path';

const input = await readHookInput();
const filePath = getEditedFilePath(input.tool_input);

if (!filePath || !isProjectSource(filePath)) {
  respond({});
  process.exit(0);
}

const notes = [];

// The architecture rule (backend only, no UI unless an issue asks) is injected the first time a
// chat edits harness source, and again whenever an edit breaks it.
const relative = path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
const conversationId = input.conversation_id;
const ruleShown = getChatState(conversationId)?.architectureRuleShown === true;
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
    rememberRuleShown(conversationId);
  }
}

respond(notes.length > 0 ? { additional_context: notes.join('\n\n') } : {});

/** Advisory: a state write that fails (read-only home, full disk) must not lose the notes. */
function rememberRuleShown(id) {
  try {
    updateChatState({ conversationId: id, architectureRuleShown: true });
  } catch {
    // The rule is just shown again on the next edit.
  }
}
