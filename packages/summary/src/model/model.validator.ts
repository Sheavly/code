import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { SummaryReplyError } from '../errors/summary.errors.js';
import type { ModelSection } from '../sections/sections.types.js';

/** The reply asked for: one JSON object, a section's id to that section's whole new text. */
const replySchema = z.record(z.string(), z.string());

/** The JSON object in `text`: the whole reply, or the one inside a code fence the model added. */
function jsonText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);

  return (fenced?.[1] ?? text).trim();
}

/**
 * What a reply looked like, for a diagnosis, without any of its text (it is model-written over
 * material that may hold secrets): its length, and what it starts with.
 */
function replyShape(reply: string): string {
  return `${String(reply.length)} characters, starting with ${replyOpening(reply.trimStart())}`;
}

/** What a reply opens with, as a few plain words. */
function replyOpening(start: string): string {
  if (start === '') return 'nothing';
  if (start.startsWith('```')) return 'a code fence';
  if (start.startsWith('{')) return 'a brace';
  if (start.startsWith('[')) return 'a bracket';

  return 'prose';
}

/**
 * The text of each section the model wrote, by section id, from its raw reply. Only the asked-for
 * sections count: another key is ignored, and a section left empty is left out. Throws a
 * `SummaryReplyError` (without quoting the reply) when it is not a JSON object of strings or
 * holds nothing for any asked-for section.
 */
export function parseSectionReply(params: {
  summarizer: string;
  reply: string;
  sections: readonly ModelSection[];
}): Map<string, string> {
  const { summarizer, reply, sections } = params;
  let raw: unknown;

  try {
    raw = JSON.parse(jsonText(reply));
  } catch (caughtError) {
    // Only malformed JSON is the model's doing; anything else would be a bug and is rethrown.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;
    throw new SummaryReplyError({
      summarizer,
      problem: `it is not JSON (${replyShape(reply)})`,
      cause: caughtError,
    });
  }

  const parsed = parseOrThrow({
    schema: replySchema,
    input: raw,
    onInvalid: ({ error }) =>
      new SummaryReplyError({
        summarizer,
        problem: `it is not an object of section texts (${replyShape(reply)})`,
        cause: error,
      }),
  });
  const written = new Map<string, string>();

  for (const { id } of sections) {
    const body = parsed[id]?.trim();

    if (body) written.set(id, body);
  }

  if (written.size === 0) {
    throw new SummaryReplyError({
      summarizer,
      problem: `it wrote none of the sections asked for (${replyShape(reply)})`,
    });
  }

  return written;
}
