import { z } from 'zod';
import { CONTROL_CHARACTERS, CONTROL_CHARACTERS_BUT_NEWLINE } from './manifest.constants.js';
import { extensionManifestSchema } from './manifest.validator.js';

/**
 * `text` made safe to put in an error message: control and format characters (bidi controls
 * included) become spaces (a line break stays when `keepNewlines`) and what is past `max` code
 * points is cut, never in the middle of a surrogate pair. Text that comes from a file's content
 * can hold anything, including terminal escape sequences.
 */
export function printable(params: { text: string; max: number; keepNewlines?: boolean }): string {
  const { text, max, keepNewlines = false } = params;
  const clean = text.replace(
    keepNewlines ? CONTROL_CHARACTERS_BUT_NEWLINE : CONTROL_CHARACTERS,
    ' ',
  );

  const points = Array.from(clean);

  return points.length > max ? `${points.slice(0, max).join('')}… (cut)` : clean;
}

/**
 * The manifest schema as JSON Schema (draft 2020-12), for editors and for installers that do not
 * run TypeScript. It describes what a file may hold, so the fields with a default are optional.
 */
export function manifestJsonSchema(): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(extensionManifestSchema, { io: 'input' });
}
