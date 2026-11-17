import { plainTerminalText } from '../render/terminal-text.utils.js';
import type { ReplaySummary } from './replay.types.js';

/** What is wrong with the stream, one line each; empty when nothing is. */
function findingsOf(summary: ReplaySummary): string[] {
  const findings = summary.gaps.map(
    ({ after, next }) => `seq gap: ${String(after)} is followed by ${String(next)}`,
  );

  if (summary.outcome === undefined) {
    findings.push('no `done` of the main session: the run was cut off, or is still going');
  }

  if (summary.truncatedLastLine) {
    findings.push('the last line is cut off (a write that a crash interrupted); it was not read');
  }

  if (summary.invalidLines.length > 0) {
    findings.push(`not an entry: line(s) ${summary.invalidLines.join(', ')}`);
  }

  return findings;
}

/** The summary as text for a person, ending with what is wrong or `no findings`. */
export function describeSummary(summary: ReplaySummary): string {
  const lines = [
    `${summary.entries} entries from a ${summary.source}` +
      (summary.outcome === undefined ? '' : `, the run ${summary.outcome}`),
    '',
    'Entries per kind:',
    ...Object.entries(summary.kinds).map(([kind, count]) => `  ${kind.padEnd(32)} ${count}`),
    '',
    'Sessions:',
    ...summary.sessions.map(
      ({ id, title, parent, state, lastOutcome }) =>
        `  ${plainTerminalText(id)}  ${plainTerminalText(title)}${parent === undefined ? '' : ` (of ${plainTerminalText(parent)})`}  ${state}${lastOutcome === undefined ? '' : ` · ${lastOutcome}`}`,
    ),
    '',
    'Tasks:',
    ...summary.tasks.map(
      ({ id, command, status, exitCode }) =>
        `  ${plainTerminalText(id)}  ${plainTerminalText(status)}${exitCode === undefined ? '' : ` · exit ${exitCode ?? '?'}`}  ${plainTerminalText(command)}`,
    ),
    '',
  ];
  const findings = findingsOf(summary);

  lines.push('Findings:', ...(findings.length > 0 ? findings.map((f) => `  ✗ ${f}`) : ['  none']));

  return `${lines.join('\n')}\n`;
}
