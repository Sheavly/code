import { readFileSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { ExtensionManifestError } from '../errors/manifest.errors.js';
import { MAX_ECHOED_DETAILS, MAX_ECHOED_REASON, MAX_MANIFEST_BYTES } from './manifest.constants.js';
import type { ExtensionManifest } from './manifest.types.js';
import { printable } from './manifest.utils.js';
import { extensionManifestSchema } from './manifest.validator.js';

/** A reason from a caught error, safe to echo: one line, no control characters, cut short. */
function reasonOf(caughtError: unknown): string {
  const reason = caughtError instanceof Error ? caughtError.message : String(caughtError);

  return printable({ text: reason, max: MAX_ECHOED_REASON });
}

/** What a message says about a file of `size` bytes that is over the cap. */
function refusalOfSize(size: number): string {
  return `is ${size} bytes, more than the ${MAX_MANIFEST_BYTES} a manifest may have`;
}

/** Why `stat` is not a manifest we read (not a regular file, or too large), if it is not. */
function refusal(stat: Stats): string | undefined {
  if (!stat.isFile()) {
    return 'is not a regular file (a directory, pipe or device cannot be a manifest)';
  }

  return stat.size > MAX_MANIFEST_BYTES ? refusalOfSize(stat.size) : undefined;
}

/**
 * The text of the file, or an `ExtensionManifestError` saying why it cannot be read. Only a
 * regular file under the size cap is read, so a pipe is never opened (it would block) and a huge
 * file is never loaded. The check is a `stat` before the read, not on the opened file (`open` is
 * kept out of this package by `harness/no-direct-file-writes`): a file swapped in between is not
 * caught, but the size is checked again on what was read.
 */
function readText(params: { source: string | URL; file: string }): string {
  const { source, file } = params;

  try {
    const problem = refusal(statSync(source));

    if (problem !== undefined) throw new ExtensionManifestError({ file, problem });

    const bytes = readFileSync(source);

    if (bytes.length > MAX_MANIFEST_BYTES) {
      throw new ExtensionManifestError({ file, problem: refusalOfSize(bytes.length) });
    }

    return bytes.toString('utf8');
  } catch (caughtError) {
    if (caughtError instanceof ExtensionManifestError) throw caughtError;

    throw new ExtensionManifestError({
      file,
      problem: `cannot be read: ${reasonOf(caughtError)}`,
      cause: caughtError,
    });
  }
}

/** The JSON in the text, or an `ExtensionManifestError` saying it is not JSON. */
function parseJson(params: { text: string; file: string }): unknown {
  const { text, file } = params;

  if (text.startsWith('\uFEFF')) {
    throw new ExtensionManifestError({
      file,
      problem: 'starts with a byte order mark (BOM): save it as UTF-8 without one',
    });
  }

  try {
    return JSON.parse(text);
  } catch (caughtError) {
    throw new ExtensionManifestError({
      file,
      problem: `is not valid JSON (comments and trailing commas are not allowed): ${reasonOf(caughtError)}`,
      cause: caughtError,
    });
  }
}

/**
 * Reads and validates a `sheavly.json`, running none of the extension's code, so an installer
 * can read what an extension needs before it runs and an extension can read its own. Synchronous,
 * strict JSON. Throws an `ExtensionManifestError` naming the file for a missing file, one that is
 * not a regular file or is over 256 KiB, a leading byte order mark, invalid JSON, an unknown key
 * or a wrong type. What the error echoes from the file's content is cut short and has no control
 * characters.
 *
 * A string `source` is opened as given: it is not confined to any root, so a caller must not pass
 * a path it did not choose (an installer reading an untrusted location checks it first).
 *
 * An extension reads its own from the package root: its helper lives in `src/<folder>/` (and
 * `dist/<folder>/` once built), two levels below it, so
 * `readManifest(new URL('../../sheavly.json', import.meta.url))` finds it in both layouts.
 *
 * This is the one place in the package that touches the file system: the rest stays free of I/O.
 */
export function readManifest(source: string | URL): ExtensionManifest {
  const file = typeof source === 'string' ? source : fileURLToPath(source);
  const json = parseJson({ text: readText({ source, file }), file });

  return parseOrThrow({
    schema: extensionManifestSchema,
    input: json,
    onInvalid: ({ details, error }) =>
      new ExtensionManifestError({
        file,
        problem: `\n${printable({ text: details, max: MAX_ECHOED_DETAILS, keepNewlines: true })}`,
        cause: error,
      }),
  });
}
