import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { formatCheckpoint } from '@sheavly/core/summary/summary.utils';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';
import { escapeTags, oneLine } from '@sheavly/core/text/text.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { z } from 'zod';
import { EXCERPT_CHARS } from './history.constants.js';
import type { HistoryCursor, SearchScope } from './history.types.js';

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

const cursorSchema = z.object({
  session: sessionIdSchema,
  seq: z.number().int().nonnegative(),
  scope: z.object({
    session: sessionIdSchema.optional(),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
  }),
});

/**
 * What to say about the part of an entry shown: nothing when it is all of it, else which
 * characters and where to read on, and for an `offset` past the end, how long the entry is.
 */
export function entryPartNote(params: { offset: number; length: number; total: number }): string {
  const { offset, length, total } = params;

  if (offset >= total && total > 0) {
    return `\n(offset ${String(offset)} is past the end: the entry has ${String(total)} characters)`;
  }

  const end = Math.min(offset + length, total);

  if (offset === 0 && end === total) return '';

  const more = end < total ? `; read on with offset ${String(end)}` : '';

  return `\n(characters ${String(offset)} to ${String(end)} of ${String(total)}${more})`;
}

/**
 * Where `query` first occurs in `text`, ignoring case, as an index into `text` itself. A match
 * is looked for in the original characters, because lowercasing can change a text's length and
 * the index is used to slice the original.
 */
export function matchIndex(params: { text: string; query: string }): number {
  const { text, query } = params;

  return text.search(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

/** A cursor as the opaque text the agent passes back. */
export function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** The cursor in `text`, or a `ToolCallError` for one the agent made up. */
export function decodeCursor(text: string): HistoryCursor {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(text, 'base64url').toString()));

    if (parsed.success) return parsed.data;
  } catch (caughtError) {
    // Text that is not JSON is a cursor the agent made up, refused below; any other failure is not.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;
  }

  throw new ToolCallError({
    reason: 'invalid_input',
    message: 'That cursor is not one a search gave: pass it back exactly as shown',
  });
}

/** Whether `a` and `b` limit a search to the same session and span. */
export function sameScope(params: { a: SearchScope; b: SearchScope }): boolean {
  const { a, b } = params;

  return a.session === b.session && (a.from ?? 0) === (b.from ?? 0) && a.to === b.to;
}
