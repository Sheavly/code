import { SummaryReplyError } from '../errors/summary.errors.js';
import type { ModelSection } from '../sections/sections.types.js';
import { FENCE, MAX_HEADING_LINE_CHARS } from './model.constants.js';

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

/** The reply without a code fence wrapped around all of it, which a model sometimes adds. */
function unfenced(reply: string): string {
  const lines = reply.trim().split(/\r?\n/);
  const first = lines[0] ?? '';

  if (!first.startsWith(FENCE)) return reply.trim();

  const last = lines.at(-1)?.trim() ?? '';
  const closed = lines.length > 1 && last === FENCE;

  return lines
    .slice(1, closed ? -1 : undefined)
    .join('\n')
    .trim();
}

/** A heading's or a title's words as compared: no marks at the ends, one space, any case. */
function words(text: string): string {
  let start = 0;
  let end = text.length;
  const mark = (char: string | undefined) => char === '#' || char === '*' || char === ':';

  while (start < end && (mark(text[start]) || /\s/.test(text[start] ?? ''))) start += 1;
  while (end > start && (mark(text[end - 1]) || /\s/.test(text[end - 1] ?? ''))) end -= 1;

  return text.slice(start, end).replaceAll(/\s+/g, ' ').toLowerCase();
}

/**
 * What a line reads as a heading, or undefined when it is not one: a line of `#`s then words, or
 * words wrapped in `**`, short enough to be a heading. Linear in the line, and a long line is
 * never looked at, since reply text is model-written and can be anything.
 */
function headingOf(line: string): string | undefined {
  if (line.length > MAX_HEADING_LINE_CHARS) return undefined;

  const text = line.trim();
  const hashed = /^#{1,6}\s/.test(text);
  const bold = text.startsWith('**') && (text.endsWith('**') || text.endsWith('**:'));

  return hashed || bold ? words(text) : undefined;
}

/** The id of the asked-for section a heading names, by its title or its id. */
function sectionOf(params: {
  heading: string;
  sections: readonly ModelSection[];
}): string | undefined {
  return params.sections.find(
    ({ id, title }) => params.heading === words(title) || params.heading === words(id),
  )?.id;
}

/**
 * The text under each heading that names an asked-for section, by section id. A heading that names
 * none stays part of the text above it, text before the first heading is ignored, and a line
 * inside a code fence is text, never a heading.
 */
function byHeading(params: {
  text: string;
  sections: readonly ModelSection[];
}): Map<string, string> {
  const { text, sections } = params;
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  let inFence = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith(FENCE)) inFence = !inFence;

    const heading = inFence ? undefined : headingOf(line);
    const id = heading === undefined ? undefined : sectionOf({ heading, sections });

    if (id === undefined) {
      current?.push(line);
      continue;
    }

    current = found.get(id) ?? [];
    found.set(id, current);
  }

  return new Map([...found].map(([id, body]) => [id, body.join('\n')]));
}

/** A JSON value as section text when it is text or a list of text; anything else is no text. */
function jsonText(value: unknown): string {
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join('\n');
  }

  return '';
}

/**
 * The reply as a JSON object, for a model that answers in JSON whatever it was asked: each key is a
 * section id and each value text, or a list of text, which becomes lines. Undefined when it is not
 * a JSON object, or holds text for none of the asked-for sections.
 */
function byJson(params: {
  text: string;
  sections: readonly ModelSection[];
}): Map<string, string> | undefined {
  let raw: unknown;

  try {
    raw = JSON.parse(params.text);
  } catch (caughtError) {
    // Only malformed JSON is the model's doing; anything else would be a bug and is rethrown.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    return undefined;
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const object = raw as Record<string, unknown>;
  const found = new Map(params.sections.map(({ id }) => [id, jsonText(object[id]).trim()]));

  return [...found.values()].some(Boolean) ? found : undefined;
}

/**
 * The text of each section the model wrote, by section id, from its raw reply. The reply is plain
 * text with a heading for each section (its title, as the prompt gives it) and our code attaches
 * each section's id and title; a JSON object keyed by id is also read. Only the asked-for sections
 * count, and one left empty is left out. Throws a `SummaryReplyError` (without quoting the reply)
 * when it holds nothing for any asked-for section.
 */
export function parseSectionReply(params: {
  summarizer: string;
  reply: string;
  sections: readonly ModelSection[];
}): Map<string, string> {
  const { summarizer, reply, sections } = params;
  const text = unfenced(reply);
  const json = text.startsWith('{') ? byJson({ text, sections }) : undefined;
  const found = json ?? byHeading({ text, sections });
  const written = new Map<string, string>();

  for (const { id } of sections) {
    const body = found.get(id)?.trim();

    if (body) written.set(id, body);
  }

  if (written.size === 0) {
    throw new SummaryReplyError({
      summarizer,
      problem: `it had no text under a heading for any section asked for (${replyShape(reply)})`,
    });
  }

  return written;
}
