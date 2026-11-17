import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import type { GlobResult } from './glob.types.js';
import { globTruncationPrompt } from './glob.prompt.js';

/**
 * The text the model reads: one path per line, newest first, then notes for what the list leaves
 * out: a cut (how to narrow the pattern) and what ripgrep reported it could not read.
 */
export function formatGlob(result: GlobResult): string {
  const notes = [
    ...(result.truncated ? [globTruncationPrompt(result.files.length)] : []),
    ...(result.skipped
      ? [`Some folders could not be read, so results may be incomplete: ${result.skipped}`]
      : []),
  ];
  const body =
    result.files.length === 0
      ? `No files match ${result.pattern} in ${result.searched}.`
      : result.files.join('\n');

  return notes.length === 0 ? body : `${body}\n${notes.map((note) => `[${note}]`).join('\n')}`;
}

/** True if `artifact` is the result `glob` returned. */
export function isGlobResult(artifact: ToolArtifact): artifact is GlobResult {
  return artifact.kind === 'glob_files';
}
