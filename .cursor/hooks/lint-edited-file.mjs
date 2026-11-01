// postToolUse (Write): format the file the agent just edited with Prettier, then lint it and hand
// the problems straight back, so they're fixed while the file is fresh instead of piling up
// until the stop check. Advisory: it never blocks the edit. The stop hook (check-on-stop.mjs)
// enforces.
import {
  FORMATTABLE,
  formatEslintReport,
  getEditedFilePath,
  isProjectSource,
  LINTABLE,
  readHookInput,
  respond,
  runBin,
} from './hooks.utils.mjs';

const input = await readHookInput();
const filePath = getEditedFilePath(input.tool_input);

if (!filePath || !isProjectSource(filePath)) {
  respond({});
  process.exit(0);
}

const notes = [];

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

    notes.push(
      'ESLint found problems in the file you just edited. Fix them in code ' +
        `(inline eslint-disable comments are not allowed in this project):\n${problems.join('\n')}`,
    );
  }
}

respond(notes.length > 0 ? { additional_context: notes.join('\n\n') } : {});
