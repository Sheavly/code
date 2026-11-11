import type { SummaryMessage } from '@sheavly/protocol/message/message.types';
import { neutralize, oneLine } from '../text/text.utils.js';
import { renderCheckpoint } from './summary.prompt.js';

/**
 * The text a model sees in place of everything a checkpoint replaces: its sections inside an
 * envelope that names their origin. A section's title and body are model-written, so they are
 * inserted as data between fixed lines and cannot close the envelope early.
 */
export function formatCheckpoint(checkpoint: SummaryMessage): string {
  const sections = checkpoint.sections.map((section) => ({
    title: oneLine(neutralize(section.title)),
    body: neutralize(section.body),
  }));

  return renderCheckpoint(sections);
}
