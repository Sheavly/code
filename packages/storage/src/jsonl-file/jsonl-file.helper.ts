import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { validate } from '@sheavly/core/validation/validation.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError } from '../errors/storage.errors.js';
import { replaceFile } from '../json-file/json-file.helper.js';
import { PRIVATE_FILE_MODE, PRIVATE_FOLDER_MODE } from '../json-file/json-file.constants.js';
import { NEWLINE } from './jsonl-file.constants.js';

/**
 * Adds `value` to the end of `file` as one JSON line, creating the file and its folders, private to
 * the user where the system has file modes. Throws a `StorageFileError` naming `file`. Lines are
 * appended one at a time: whoever appends several in a row waits for each (see `SerialQueue`).
 */
export async function appendJsonLine(params: { file: string; value: unknown }): Promise<void> {
  const { file, value } = params;

  try {
    await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_FOLDER_MODE });
    await appendFile(file, `${JSON.stringify(value)}\n`, { mode: PRIVATE_FILE_MODE });
  } catch (caughtError) {
    throw new StorageFileError({ file, cause: caughtError });
  }
}

/**
 * Creates `file` holding `values`, one JSON line each, all at once: written to a temp file beside
 * it and renamed into place, so a crash leaves either no file or the whole one, never a prefix a
 * reader would take for the complete log. Replaces a file already there. Throws a
 * `StorageFileError` naming `file`; the temp file is removed.
 */
export async function writeJsonLines(params: {
  file: string;
  values: readonly unknown[];
}): Promise<void> {
  const { file, values } = params;
  const temp = `${file}.${randomUUID()}.tmp`;

  try {
    await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_FOLDER_MODE });
    await writeFile(temp, values.map((value) => `${JSON.stringify(value)}\n`).join(''), {
      mode: PRIVATE_FILE_MODE,
    });
    await replaceFile({ from: temp, to: file });
  } catch (caughtError) {
    await rm(temp, { force: true });
    throw new StorageFileError({ file, cause: caughtError });
  }
}

/**
 * The lines of `file` as `schema` values, oldest first, read as a stream so a long file is never
 * held whole. No file yields nothing. Throws a `StorageFileError` naming the file and the line for
 * a line that is not JSON or not what `schema` says, and never quotes it: a conversation holds
 * private text. A last line with no newline after it is a write that was cut off, and is not read.
 */
export async function* readJsonLines<TSchema extends z.ZodType>(params: {
  file: string;
  schema: TSchema;
}): AsyncGenerator<z.infer<TSchema>> {
  const { file, schema } = params;
  let pending = '';
  let lineNumber = 0;

  try {
    for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
      pending += String(chunk);

      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
        lineNumber += 1;
        yield parseLine({ text: pending.slice(0, end), schema, file, lineNumber });
        pending = pending.slice(end + 1);
      }
    }
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return;
    if (caughtError instanceof StorageFileError) throw caughtError;
    throw new StorageFileError({ file, cause: caughtError });
  }
}

/**
 * Cuts a last line that has no newline after it from `file`: a write that was cut off by a crash.
 * Without it, the next line appended would join onto the half-written one. A file that ends in a
 * newline, or is not there, is left alone. Returns how many bytes were cut.
 */
export async function trimPartialLine(params: { file: string }): Promise<number> {
  const { file } = params;

  try {
    const { size } = await stat(file);
    const handle = await open(file, 'r+');

    try {
      const keep = await lengthThroughLastNewline({ handle, size });

      if (keep < size) await handle.truncate(keep);

      return size - keep;
    } finally {
      await handle.close();
    }
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return 0;
    throw new StorageFileError({ file, cause: caughtError });
  }
}

/** One line as a `schema` value; the error names the line and does not show it. */
function parseLine<TSchema extends z.ZodType>(params: {
  text: string;
  schema: TSchema;
  file: string;
  lineNumber: number;
}): z.infer<TSchema> {
  const { text, schema, file, lineNumber } = params;
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (caughtError) {
    // A SyntaxError's message quotes the text around the fault, and a conversation is private, so
    // it is replaced by a fixed one without the error as `cause`; any other failure is not ours.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    throw new StorageFileError({
      file,
      cause: undefined,
      reason: `line ${String(lineNumber)} is not valid JSON (it is not shown: a conversation is private)`,
    });
  }

  const result = validate({ schema, input: json });

  if (!result.success) {
    throw new StorageFileError({
      file,
      cause: undefined,
      reason: `line ${String(lineNumber)} is not what it should be:\n${result.details}`,
    });
  }

  return result.data;
}

/** The byte length of `file` up to and including its last newline: 0 when it has none. */
async function lengthThroughLastNewline(params: {
  handle: Awaited<ReturnType<typeof open>>;
  size: number;
}): Promise<number> {
  const { handle, size } = params;
  const block = Buffer.alloc(1);

  for (let position = size - 1; position >= 0; position -= 1) {
    await handle.read(block, 0, 1, position);

    if (block[0] === NEWLINE) return position + 1;
  }

  return 0;
}
