import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { STATE_VERSION } from './workbook.constants.js';
import type { StoredPrompt } from './workbook.types.js';
import { WorkbookPromptError } from '../runtime/errors/workbook.errors.js';
import { checkSchema } from './check.validator.js';

// --- Schemas: everything the workbook reads back from disk is validated ---

/**
 * A prompt file's front matter (between `---` lines at the top), all optional:
 * `workspace` (a fixture folder in `workbook/workspaces/` to copy for each run), `maxTurns`.
 */
export const promptFileSchema = z.object({
  text: z.string().min(1),
  workspace: z.string().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  description: z.string().optional(),
  /** A real-model check of this prompt (see `check.validator.ts`): run by `workbook check`. */
  check: checkSchema.optional(),
});

export const runMetaSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  text: z.string(),
  /** The run this one continues (its history is the starting point). */
  continues: z.string().optional(),
  startedAt: z.string(),
  adapter: z.string(),
  model: z.string(),
  workspace: z.string(),
  mainSession: z.string(),
  gitCommit: z.string().optional(),
});

export const runResultSchema = z.object({
  outcome: z.enum(['completed', 'interrupted', 'max_turns', 'failed']),
  error: z.string().optional(),
  endedAt: z.string(),
  durationMs: z.number(),
  events: z.number(),
  modelCalls: z.number(),
  toolCalls: z.number(),
  toolErrors: z.number(),
  sessions: z.number(),
  messages: z.number(),
  /** The last event before the run ended, so a failure shows what it was doing. */
  lastEvent: z.string().optional(),
});

export const stateSchema = z.object({
  version: z.literal(STATE_VERSION),
  /** Runs started so far; the next run is number `runCount + 1`. */
  runCount: z.number().int().nonnegative(),
  lastRun: z.string().optional(),
  /** The latest run of each prompt, by prompt name. */
  lastRunByPrompt: z.record(z.string(), z.string()),
});

// --- Prompt files: front matter, then text ---

/**
 * Front matter lines as `key: value` fields. A value starting with `{` or `[` is JSON (or the
 * YAML flow style Prettier formats it as), and may go on over the following indented lines (a
 * `check`); digits are a number; anything else is text, so a plain prompt reads as before.
 */
function frontMatterFields(params: { name: string; lines: string[] }): Record<string, unknown> {
  const { name, lines } = params;
  const raw: [string, string][] = [];

  for (const line of lines) {
    const pair = /^(\w+):\s*(.*)$/.exec(line);
    const last = raw.at(-1);

    if (pair?.[1] && pair[2] !== undefined) raw.push([pair[1], pair[2]]);
    else if (last && /^\s/.test(line)) last[1] += `\n${line}`;
  }

  return Object.fromEntries(
    raw.map(([key, value]) => [key, frontMatterValue({ name, key, value: value.trim() })]),
  );
}

/** A `'single'`-quoted YAML string at `start` (`''` is a quote), as a JSON string, and its end. */
function singleQuoted(params: { text: string; start: number }): { json: string; end: number } {
  const { text, start } = params;
  let value = '';
  let index = start + 1;

  while (index < text.length) {
    if (text[index] === "'" && text[index + 1] === "'") {
      value += "'";
      index += 2;
    } else if (text[index] === "'") {
      return { json: JSON.stringify(value), end: index + 1 };
    } else {
      value += text[index] ?? '';
      index += 1;
    }
  }

  return { json: JSON.stringify(value), end: index };
}

/** A `"double"`-quoted string at `start`, unchanged (escapes kept), and its end. */
function doubleQuoted(params: { text: string; start: number }): { json: string; end: number } {
  const { text, start } = params;
  let index = start + 1;

  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;

  return { json: text.slice(start, index + 1), end: index + 1 };
}

/**
 * YAML flow style (what Prettier writes front matter as: single quotes, trailing commas) as
 * JSON, so a `check` stays readable either way. Strings are copied, never searched, so a quote
 * or comma inside one is kept as it is.
 */
function flowToJson(text: string): string {
  let json = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index] ?? '';

    if (char === "'" || char === '"') {
      const quoted = (char === "'" ? singleQuoted : doubleQuoted)({ text, start: index });

      json += quoted.json;
      index = quoted.end;
    } else if (char === ',' && /^\s*[}\]]/.test(text.slice(index + 1))) {
      index += 1; // a trailing comma: JSON has none
    } else {
      json += char;
      index += 1;
    }
  }

  return json;
}

function frontMatterValue(params: { name: string; key: string; value: string }): unknown {
  const { name, key, value } = params;

  if (/^\d+$/.test(value)) return Number(value);
  if (!/^[{[]/.test(value)) return value;

  try {
    return JSON.parse(flowToJson(value));
  } catch (caughtError) {
    if (!(caughtError instanceof SyntaxError)) throw caughtError;
    throw new WorkbookPromptError({
      name,
      cause: caughtError,
      problems: `${key}: ${caughtError.message}`,
    });
  }
}

/**
 * A stored prompt file: optional front matter (`key: value` lines between `---`), then the
 * prompt text. Plain markdown with no front matter is just a prompt.
 */
export function parsePromptFile(params: { name: string; source: string }): StoredPrompt {
  const { name, source } = params;
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source);
  const fields: Record<string, unknown> = {
    text: (match ? match[2] : source)?.trim() ?? '',
    ...frontMatterFields({ name, lines: match?.[1]?.split('\n') ?? [] }),
  };

  const parsed = parseOrThrow({
    schema: promptFileSchema,
    input: fields,
    onInvalid: ({ details, error }) =>
      new WorkbookPromptError({ name, cause: error, problems: details }),
  });

  return { name, ...parsed };
}
