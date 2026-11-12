import { SummaryReplyError } from '../errors/summary.errors.js';
import type { ModelSection } from '../sections/sections.types.js';

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
  const text = reply.trim();
  const fenced = /^```[\w-]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text);

  return (fenced?.[1] ?? text).trim();
}

/** A heading's words as compared with a section: no marks, no trailing colon, any case. */
function headingWords(line: string): string | undefined {
  const marked =
    /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) ?? /^\s{0,3}\*\*(.+?)\*\*:?\s*$/.exec(line);

  return marked?.[1]?.replace(/[*:\s]+$/, '').toLowerCase();
}

/** The id of the asked-for section a line is the heading of, by its title or its id. */
function sectionOf(params: {
  line: string;
  sections: readonly ModelSection[];
}): string | undefined {
  const words = headingWords(params.line);

  if (words === undefined) return undefined;

  return params.sections.find(
    ({ id, title }) => words === title.toLowerCase() || words === id.toLowerCase(),
  )?.id;
}

/**
 * The text under each heading that names an asked-for section, by section id. A heading that names
 * none stays part of the text above it, and text before the first heading is ignored.
 */
function byHeading(params: {
  text: string;
  sections: readonly ModelSection[];
}): Map<string, string> {
  const { text, sections } = params;
  const lines = new Map<string, string[]>();
  let current: string[] | undefined;

  for (const line of text.split(/\r?\n/)) {
    const id = sectionOf({ line, sections });

    if (id === undefined) {
      current?.push(line);
      continue;
    }

    current = lines.get(id) ?? [];
    lines.set(id, current);
  }

  return new Map([...lines].map(([id, body]) => [id, body.join('\n')]));
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
 * a JSON object.
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

  return new Map(params.sections.map(({ id }) => [id, jsonText(object[id])]));
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
  const found =
    (text.startsWith('{') ? byJson({ text, sections }) : undefined) ??
    byHeading({ text, sections });
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
