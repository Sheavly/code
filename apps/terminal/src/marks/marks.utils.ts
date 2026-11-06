import { MARK_CARRIERS } from './marks.constants.js';
import type { ShellMark } from './marks.types.js';

const MARKS = Object.keys(MARK_CARRIERS) as ShellMark[];

function semanticPrompt(payload: string): string {
  return `\u001b]133;${payload}\u001b\\`;
}

/**
 * The OSC 133 sequence for `mark`, which a terminal reads from the start of a row. The user's
 * message is both the prompt and its input (`A` then `B`); the output starts under it (`C`); and
 * a turn ends with its exit status (`D`), 1 for one that failed.
 */
export function shellMarkSequence(mark: ShellMark): string {
  switch (mark) {
    case 'prompt':
      return `${semanticPrompt('A')}${semanticPrompt('B')}`;
    case 'output':
      return semanticPrompt('C');
    case 'done':
      return semanticPrompt('D;0');
    case 'failed':
      return semanticPrompt('D;1');
  }
}

/** What stands for `mark` in text that goes through Ink, put at the start of a row. */
export function carryMark(mark: ShellMark): string {
  return `\u001b[${String(MARK_CARRIERS[mark])}m`;
}

/** `text` with every carried mark replaced by its real sequence. */
export function restoreMarks(text: string): string {
  let restored = text;

  for (const mark of MARKS) {
    restored = restored.replaceAll(carryMark(mark), shellMarkSequence(mark));
  }

  return restored;
}
