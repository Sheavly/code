import { z } from 'zod';
import { OutputError } from '@sheavly/core/errors/output.errors';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { OutputStore } from '@sheavly/core/output/output.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { escapeTags, fenceDashes } from '@sheavly/core/text/text.utils';
import {
  DEFAULT_MAX_MATCHES,
  DEFAULT_READ_BYTES,
  MAX_MATCHES,
  MAX_QUERY_CHARS,
  MAX_READ_BYTES,
} from '@sheavly/protocol/output/output.constants';
import { outputRefSchema } from '@sheavly/protocol/output/output.validator';
import { readOutputPrompts, renderOutputRange, searchOutputPrompts } from './output.prompt.js';
import { stateLine } from './output.utils.js';

/** Stored-output failures are for the model to read: turn them into a refused call. */
async function asToolCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (caughtError) {
    if (!(caughtError instanceof OutputError)) throw caughtError;

    const reasons = {
      invalid_range: 'invalid_input',
      not_found: 'not_found',
      unavailable: 'unavailable',
      quota_exceeded: 'unavailable',
    } as const;

    throw new ToolCallError({ reason: reasons[caughtError.reason], message: caughtError.message });
  }
}

function createReadOutputTool(outputs: OutputStore) {
  return defineTool({
    name: 'read_output',
    description: readOutputPrompts.description,
    inputSchema: z.object({
      ref: outputRefSchema.describe(readOutputPrompts.ref),
      offset: z.number().int().nonnegative().optional().describe(readOutputPrompts.offset),
      maxBytes: z
        .number()
        .int()
        .positive()
        .max(MAX_READ_BYTES)
        .optional()
        .describe(readOutputPrompts.maxBytes),
    }),
    execute: async ({ input: { ref, offset = 0, maxBytes = DEFAULT_READ_BYTES } }) =>
      asToolCall(async () => {
        const range = await outputs.read({ ref, offset, maxBytes });

        // Command output is untrusted: its angle brackets are swapped so it cannot close the fence.
        const body = escapeTags(range.text);

        return renderOutputRange({
          ref,
          offset: String(range.offset),
          endOffset: String(range.nextOffset ?? range.totalBytes),
          totalBytes: String(range.totalBytes),
          next: range.nextOffset === undefined ? undefined : String(range.nextOffset),
          state: stateLine(range),
          fence: fenceDashes(body),
          body,
        });
      }),
  });
}

function createSearchOutputTool(outputs: OutputStore) {
  return defineTool({
    name: 'search_output',
    description: searchOutputPrompts.description,
    inputSchema: z.object({
      ref: outputRefSchema.describe(searchOutputPrompts.ref),
      query: z.string().min(1).max(MAX_QUERY_CHARS).describe(searchOutputPrompts.query),
      fromOffset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(searchOutputPrompts.fromOffset),
      maxMatches: z
        .number()
        .int()
        .positive()
        .max(MAX_MATCHES)
        .optional()
        .describe(searchOutputPrompts.maxMatches),
    }),
    execute: async ({ input: { ref, query, fromOffset = 0, maxMatches = DEFAULT_MAX_MATCHES } }) =>
      asToolCall(async () => {
        const found = await outputs.search({ ref, query, fromOffset, maxMatches });
        const head = `output_ref=${ref} ${String(found.matches.length)} match(es) (${stateLine(found)}), ${String(found.totalBytes)} bytes stored`;
        const next =
          found.nextOffset === undefined
            ? 'Search reached the end of stored output.'
            : `next_offset=${String(found.nextOffset)} (search stopped early; continue with from_offset)`;
        const body = found.matches
          .map((match) => `@${String(match.offset)}: ${JSON.stringify(escapeTags(match.snippet))}`)
          .join('\n');

        return [head, next, body].filter(Boolean).join('\n');
      }),
  });
}

/**
 * `read_output` and `search_output` over one conversation's stored command output. Give it that
 * conversation's store only: a reference that is not in it is `not_found`, so a call cannot reach
 * another conversation's logs.
 */
export function createOutputTools(outputs: OutputStore) {
  return [createReadOutputTool(outputs), createSearchOutputTool(outputs)];
}
