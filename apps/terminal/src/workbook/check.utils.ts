import type { CheckOutcome, Observed, RunExpectation, RunSources } from './check.types.js';

// --- Judging a run ---

/** `/…/flags` is a regex; anything else is a plain substring. */
function matches(params: { pattern: string; text: string }): boolean {
  const { pattern, text } = params;
  const regex = /^\/(.+)\/([a-z]*)$/s.exec(pattern);

  if (!regex?.[1]) return text.includes(pattern);

  return new RegExp(regex[1], regex[2]).test(text);
}

/** Problems with the text targets: an expected pattern missing, or a forbidden one present. */
function textProblems(params: {
  wanted: string[] | undefined;
  forbidden: string[] | undefined;
  target: string;
  text: string;
}): string[] {
  const { wanted = [], forbidden = [], target, text } = params;

  return [
    ...wanted.filter((pattern) => !matches({ pattern, text })).map((p) => `${target} lacks ${p}`),
    ...forbidden.filter((pattern) => matches({ pattern, text })).map((p) => `${target} has ${p}`),
  ];
}

/** Problems with the named targets (events, tools): one expected and missing, or forbidden. */
function nameProblems(params: {
  wanted: string[] | undefined;
  forbidden: string[] | undefined;
  target: string;
  seen: readonly string[];
}): string[] {
  const { wanted = [], forbidden = [], target, seen } = params;

  return [
    ...wanted.filter((name) => !seen.includes(name)).map((name) => `no ${name} in ${target}`),
    ...forbidden.filter((name) => seen.includes(name)).map((name) => `${name} in ${target}`),
  ];
}

/** Every expectation `observed` breaks, as readable lines; empty when the run passed. */
export function judgeRun(params: { expectation: RunExpectation; observed: Observed }): string[] {
  const { expectation, observed } = params;
  const { expect: wanted = {}, forbid = {} } = expectation;
  const outcome =
    wanted.outcome && wanted.outcome !== observed.outcome
      ? [`outcome ${observed.outcome}, expected ${wanted.outcome}`]
      : [];

  return [
    ...(['transcript', 'reply'] as const).flatMap((target) =>
      textProblems({
        wanted: wanted[target],
        forbidden: forbid[target],
        target,
        text: observed[target],
      }),
    ),
    ...(['events', 'tools'] as const).flatMap((target) =>
      nameProblems({
        wanted: wanted[target],
        forbidden: forbid[target],
        target,
        seen: observed[target],
      }),
    ),
    ...outcome,
  ];
}

/** True if a change to `file` (repo-relative, `/`-separated) makes a check with `areas` relevant. */
export function touchesAreas(params: {
  areas: readonly string[];
  files: readonly string[];
}): boolean {
  const { areas, files } = params;

  return files.some((file) =>
    areas.some((area) => file === area || file.startsWith(`${area.replace(/\/$/, '')}/`)),
  );
}

/**
 * True if `file` (repo-relative, `/`-separated) is source a run executes. One list, read by
 * both `workbook check` and the stop hook's nudge, so they agree on what needs a check.
 */
export function isRunSource(params: { sources: RunSources; file: string }): boolean {
  const { sources, file } = params;

  return (
    sources.include.some((prefix) => file.startsWith(prefix)) &&
    !sources.exclude.some((marker) => file.includes(marker))
  );
}

// --- Reporting ---

/** One line per check, with each failed attempt's problems under it. */
export function formatReport(outcomes: CheckOutcome[]): string {
  const marks = { passed: '✓', passed_on_retry: '~', failed: '✗', interrupted: '⏹' } as const;
  const lines = outcomes.flatMap((outcome) => [
    `${marks[outcome.status]} ${outcome.prompt}  ${outcome.status.replaceAll('_', ' ')}  (runs ${outcome.runs.join(', ')})`,
    ...outcome.attempts.flatMap((problems, index) =>
      problems.map((problem) => `    try ${index + 1}: ${problem}`),
    ),
  ]);

  return [...lines, '', summaryLine(outcomes)].join('\n');
}

/** The last line: stopped, failed, or all passed; only a run of nothing but passes says "passed". */
function summaryLine(outcomes: CheckOutcome[]): string {
  const count = (status: CheckOutcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status).length;

  if (count('interrupted') > 0) {
    return `stopped (Ctrl+C) after ${outcomes.length} check(s): not a pass`;
  }

  const failed = count('failed');

  return failed ? `${failed} of ${outcomes.length} failed` : `all ${outcomes.length} passed`;
}
