import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
import { neutralize, oneLine } from '../text/text.utils.js';
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
