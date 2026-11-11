import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import type { GrepResult } from './grep.types.js';
import { grepTruncationPrompt } from './grep.prompt.js';

function resultLines(result: GrepResult): string[] {
  if (result.mode === 'files') return result.files;

  if (result.mode === 'count') {
    return result.counts.map(({ path: file, count }) => `${file}:${count}`);
  }

  return result.matches.map(({ path: file, line, text }) => `${file}:${line}:${text}`);
}

/**
 * The text the model reads: one result per line, then notes for what the results leave out: a
 * cut (how to narrow the search) and `skipped`, what ripgrep reported it could not read.
 */
export function formatGrep(params: { result: GrepResult; skipped: string }): string {
  const { result, skipped } = params;
  const lines = resultLines(result);
  const notes = [
    ...(result.truncated ? [grepTruncationPrompt(lines.length)] : []),
    ...(skipped
      ? [`Some files could not be searched, so results may be incomplete: ${skipped}`]
      : []),
  ];
  const body =
    lines.length === 0
      ? `No matches for ${result.pattern} in ${result.searched}.`
      : lines.join('\n');

  return notes.length === 0 ? body : `${body}\n${notes.map((note) => `[${note}]`).join('\n')}`;
}

/** True if `artifact` is the result `grep` returned. */
export function isGrepResult(artifact: ToolArtifact): artifact is GrepResult {
  return artifact.kind === 'grep_matches';
}
