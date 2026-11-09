import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
import { CHECKPOINT_TEXT } from './summary.constants.js';

/**
 * The text a model sees in place of everything a checkpoint replaces: its sections inside an
 * envelope that names their origin. A section's title and body are model-written, so they are
 * inserted as data between fixed lines and cannot close the envelope early.
 */
export function formatCheckpoint(checkpoint: SummaryMessage): string {
  const sections = checkpoint.sections.map(
    (section) => `## ${oneLine(neutralize(section.title))}\n${neutralize(section.body)}`,
  );

  return [
    CHECKPOINT_TEXT.opening,
    CHECKPOINT_TEXT.origin,
    CHECKPOINT_TEXT.guidance,
    ...sections,
    CHECKPOINT_TEXT.closing,
  ].join('\n\n');
}

/**
 * Stops written text from carrying the envelope's tags or a section header of its own. Every `<`
 * is swapped, not just the envelope's spelling, because a model reads many spellings of a tag
 * (spaces, attributes, lookalike characters) and a list of them is never complete; `#` at a line
 * start is escaped so a body cannot start another section.
 */
function neutralize(text: string): string {
  return text.replaceAll(/[<＜]/g, '‹').replaceAll(/^([ \t]*)#/gm, '$1\\#');
}

/** A title is one line, so it cannot open a section of its own. */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}
