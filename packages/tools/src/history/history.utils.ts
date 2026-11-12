import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { formatCheckpoint } from '@sheavly/core/summary/summary.utils';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { escapeTags, oneLine } from '@sheavly/core/text/text.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { CURSOR_SEPARATOR, EXCERPT_CHARS } from './history.constants.js';
import type { HistoryCursor } from './history.types.js';

/** The text of an entry that a search looks through, whatever its role. */
export function entryText(entry: HistoryMessage): string {
  switch (entry.role) {
    case 'assistant':
      return [
        entry.content,
        ...entry.toolCalls.map((call) => `${call.name} ${JSON.stringify(call.input)}`),
      ]
        .filter(Boolean)
        .join('\n');

    case 'summary':
      return formatCheckpoint(entry);

    case 'notice':
      return formatHarnessNotice(entry.notice);

    default:
      return entry.content;
  }
}

/**
 * One line of context around the first match of `query` in `text`, tags swapped so it cannot open
 * an envelope. `query` must occur in `text`, ignoring case.
 */
export function excerptAround(params: { text: string; query: string }): string {
  const { text, query } = params;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at - Math.floor(EXCERPT_CHARS / 2));
  const cut = text.slice(start, start + EXCERPT_CHARS);

  return `${start > 0 ? '…' : ''}${escapeTags(oneLine(cut))}${start + EXCERPT_CHARS < text.length ? '…' : ''}`;
}

/** A cursor as the text the agent passes back. */
export function encodeCursor(cursor: HistoryCursor): string {
  return `${cursor.session}${CURSOR_SEPARATOR}${String(cursor.seq)}`;
}

/** The cursor in `text`, or a `ToolCallError` for one the agent made up. */
export function decodeCursor(text: string): HistoryCursor {
  const at = text.lastIndexOf(CURSOR_SEPARATOR);
  const session = sessionIdSchema.safeParse(text.slice(0, at));
  const seq = Number(text.slice(at + 1));

  if (at < 1 || !session.success || !Number.isInteger(seq) || seq < 0) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message: 'That cursor is not one a search gave: pass it back exactly as shown',
    });
  }

  return { session: session.data, seq };
}
