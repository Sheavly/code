import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { ReplayNotFoundError } from '../errors/replay.errors.js';
import { CONVERSATION_STREAM_FILE, RUN_STREAM_FILE } from './replay.constants.js';
import type { StoredStream, StreamSource } from './replay.types.js';
import { parseStreamText } from './stream-text.utils.js';

/**
 * A conversation's or a run's stored stream, read from its folder: `stream.jsonl` for a
 * conversation, else `sessions.sse` for a workbook run. It reads those files and nothing else in
 * the folder (never `credentials.json`, which is not in a conversation's folder anyway), and
 * makes no network or model call. Throws `ReplayNotFoundError` when the folder has neither file.
 */
export async function readStoredStream(folder: string): Promise<StoredStream> {
  const candidates: { source: StreamSource; file: string }[] = [
    { source: 'conversation', file: path.join(folder, CONVERSATION_STREAM_FILE) },
    { source: 'run', file: path.join(folder, RUN_STREAM_FILE) },
  ];

  for (const { source, file } of candidates) {
    const text = await readIfThere(file);

    if (text !== undefined) return { source, file, ...parseStreamText({ text, source }) };
  }

  throw new ReplayNotFoundError({
    wanted: folder,
    message: `No stored stream in ${folder}: expected ${CONVERSATION_STREAM_FILE} (a conversation) or ${RUN_STREAM_FILE} (a workbook run)`,
  });
}

/** A file's text, or undefined when it isn't there; any other failure is the caller's. */
async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return undefined;
    throw caughtError;
  }
}
