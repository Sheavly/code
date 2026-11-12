import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { escapeTags, fenceDashes } from '@sheavly/core/text/text.utils';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { DEFAULT_SEARCH_LIMIT, MAX_ENTRY_CHARS, MAX_SEARCH_LIMIT } from './history.constants.js';
import { readHistoryEntry, searchHistory } from './history.helper.js';
import {
  readHistoryEntryPrompts,
  retrievedHeader,
  searchHistoryPrompts,
  searchMore,
} from './history.prompt.js';
import type { HistoryToolOptions } from './history.types.js';
import { decodeCursor, encodeCursor } from './history.utils.js';

function createSearchHistoryTool(options: HistoryToolOptions) {
  return defineTool({
    name: 'search_history',
    description: searchHistoryPrompts.description,
    inputSchema: z.object({
      query: z.string().min(1).describe(searchHistoryPrompts.query),
      session: sessionIdSchema.optional().describe(searchHistoryPrompts.session),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH_LIMIT)
        .optional()
        .describe(searchHistoryPrompts.limit),
      from: z.number().int().nonnegative().optional().describe(searchHistoryPrompts.from),
      to: z.number().int().nonnegative().optional().describe(searchHistoryPrompts.to),
      cursor: z.string().optional().describe(searchHistoryPrompts.cursor),
    }),
    execute: async ({ input, signal }) => {
      const { hits, scanned, next } = await searchHistory({
        options,
        query: input.query,
        session: input.session,
        span: { from: input.from, to: input.to },
        limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
        cursor: input.cursor === undefined ? undefined : decodeCursor(input.cursor),
        signal,
      });
      const more = next ? searchMore({ cursor: encodeCursor(next), scanned }) : '';

      if (hits.length === 0) {
        return next
          ? `No match in the ${String(scanned)} entries examined so far.${more}`
          : 'No recorded entry matches.';
      }

      const lines = hits.map(
        (hit) => `- session ${hit.session}, entry ${String(hit.seq)} (${hit.role}): ${hit.excerpt}`,
      );

      return `${retrievedHeader(hits.length)}\n${lines.join('\n')}${more}`;
    },
  });
}

function createReadHistoryEntryTool(options: HistoryToolOptions) {
  return defineTool({
    name: 'read_history_entry',
    description: readHistoryEntryPrompts.description,
    inputSchema: z.object({
      session: sessionIdSchema.describe(readHistoryEntryPrompts.session),
      seq: z.number().int().nonnegative().describe(readHistoryEntryPrompts.seq),
    }),
    execute: async ({ input, signal }) => {
      const entry = await readHistoryEntry({ options, ...input, signal });
      const cut = entry.text.length > MAX_ENTRY_CHARS;
      const shown = escapeTags(cut ? entry.text.slice(0, MAX_ENTRY_CHARS) : entry.text);
      const fence = fenceDashes(shown);
      const note = cut
        ? `\n(cut after ${String(MAX_ENTRY_CHARS)} of ${String(entry.text.length)} characters)`
        : '';

      return `${retrievedHeader(1)}\nsession ${input.session}, entry ${String(input.seq)} (${entry.role})\n${fence} entry ${fence}\n${shown}\n${fence} end of entry ${fence}${note}`;
    },
  });
}

/**
 * `search_history` and `read_history_entry`: the agent's way back to the original entries a
 * summary replaced, across the conversation's main session and its sub-agents. Results are
 * bounded, paginated and carry their session and entry number; what they hold is recorded data,
 * and is framed as such.
 */
export function createHistoryTools(options: HistoryToolOptions) {
  return [createSearchHistoryTool(options), createReadHistoryEntryTool(options)];
}
