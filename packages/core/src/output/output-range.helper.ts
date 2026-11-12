import { OutputError } from '../errors/output.errors.js';
import {
  MAX_SEARCH_SCAN_BYTES,
  SEARCH_WINDOW_BYTES,
  SNIPPET_BYTES,
} from '@sheavly/protocol/output/output.constants';

import type { OutputLog } from '@sheavly/protocol/output/output.types';
import { MAX_CHARACTER_BYTES } from './output.constants.js';
import type { ByteSource, OutputRange, OutputSearch, OutputSearchParams } from './output.types.js';
import { withLogState } from './output.utils.js';

const isContinuation = (byte: number | undefined) => byte !== undefined && (byte & 0xc0) === 0x80;

/** Bytes to skip at the start of `bytes` so it begins on a character boundary. */
function leadingSplit(bytes: Buffer): number {
  let skip = 0;

  while (skip < MAX_CHARACTER_BYTES - 1 && isContinuation(bytes[skip])) skip += 1;

  return skip;
}

/** Length of `bytes` without a final character that was cut off by the end of the read. */
function completeLength(bytes: Buffer): number {
  for (let back = 1; back <= Math.min(MAX_CHARACTER_BYTES - 1, bytes.length); back += 1) {
    const byte = bytes[bytes.length - back] ?? 0;

    if (isContinuation(byte)) continue;

    return sequenceLength(byte) > back ? bytes.length - back : bytes.length;
  }

  return bytes.length;
}

/** How many bytes the UTF-8 character starting with `lead` takes. */
function sequenceLength(lead: number): number {
  if (lead >= 0xf0) return 4;
  if (lead >= 0xe0) return 3;

  return lead >= 0xc0 ? 2 : 1;
}

/**
 * Up to `maxBytes` of text from byte `offset`, on character boundaries: a character split by the
 * offset is skipped and one cut by the limit is left for the next read. `offset` past the end
 * throws `invalid_range`. `nextOffset` is where the next read starts, absent at the end.
 */
async function readRange(params: {
  source: ByteSource;
  offset: number;
  maxBytes: number;
}): Promise<{ text: string; offset: number; nextOffset?: number; totalBytes: number }> {
  const { source, offset } = params;
  // Room for one whole character, so a tiny limit still makes progress and `nextOffset` moves on.
  const maxBytes = Math.max(params.maxBytes, MAX_CHARACTER_BYTES);
  const totalBytes = await source.size();

  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalBytes) {
    throw new OutputError({
      reason: 'invalid_range',
      message: `offset ${String(offset)} is outside the stored output (0 to ${String(totalBytes)} bytes)`,
    });
  }

  const raw = await source.read({ offset, length: maxBytes + MAX_CHARACTER_BYTES });
  const skipped = leadingSplit(raw);
  const body = raw.subarray(skipped, skipped + maxBytes);
  // A read that reaches the end of the log has nothing cut off: only a limit can split a character.
  const reachedEnd = offset + skipped + body.length >= totalBytes;
  const bytes = reachedEnd ? body : body.subarray(0, completeLength(body));
  const start = offset + skipped;
  const next = start + bytes.length;

  return {
    text: bytes.toString('utf8'),
    offset: start,
    ...(next < totalBytes && { nextOffset: next }),
    totalBytes,
  };
}

/**
 * Literal, case-sensitive matches of `query` from byte `fromOffset`, with the text around each.
 * It scans at most `MAX_SEARCH_SCAN_BYTES` per call and returns `nextOffset` where it stopped
 * (after `maxMatches` matches, or at the scan limit), so a search of any log can be continued
 * to its end. An empty query throws `invalid_range`.
 */
async function searchBytes(params: {
  source: ByteSource;
  query: string;
  fromOffset: number;
  maxMatches: number;
}): Promise<{
  matches: { offset: number; snippet: string }[];
  nextOffset?: number;
  totalBytes: number;
}> {
  const { source, query, fromOffset, maxMatches } = params;
  const needle = Buffer.from(query, 'utf8');
  const totalBytes = await source.size();

  if (needle.length === 0 || !Number.isSafeInteger(fromOffset) || fromOffset < 0) {
    throw new OutputError({
      reason: 'invalid_range',
      message: 'search needs a non-empty query and a non-negative offset',
    });
  }

  const scanEnd = Math.min(totalBytes, fromOffset + MAX_SEARCH_SCAN_BYTES);
  const matches: { offset: number; snippet: string }[] = [];
  let position = fromOffset;

  while (position < scanEnd && matches.length < maxMatches) {
    // Overlap by the needle's length so a match across two windows is still found.
    const window = await source.read({
      offset: position,
      length: Math.min(SEARCH_WINDOW_BYTES, scanEnd - position) + needle.length - 1,
    });
    const found = window.indexOf(needle);

    if (found === -1) {
      position += Math.max(1, Math.min(SEARCH_WINDOW_BYTES, scanEnd - position));
      continue;
    }

    const at = position + found;

    matches.push({
      offset: at,
      snippet: await snippetAt({ source, at, length: needle.length, totalBytes }),
    });
    position = at + needle.length;
  }

  return { matches, ...(position < totalBytes && { nextOffset: position }), totalBytes };
}

/** `readRange` with the log's reference and completeness attached, as a store returns it. */
export async function readLog(params: {
  log: OutputLog;
  source: ByteSource;
  offset: number;
  maxBytes: number;
}): Promise<OutputRange> {
  const { log, source, offset, maxBytes } = params;

  return withLogState({ log, body: await readRange({ source, offset, maxBytes }) });
}

/** `searchBytes` with the log's reference and completeness attached, as a store returns it. */
export async function searchLog(
  params: OutputSearchParams & { log: OutputLog; source: ByteSource },
): Promise<OutputSearch> {
  const { log, source, query, fromOffset, maxMatches } = params;

  return withLogState({ log, body: await searchBytes({ source, query, fromOffset, maxMatches }) });
}

/** The text around a match, cut on character boundaries. */
async function snippetAt(params: {
  source: ByteSource;
  at: number;
  length: number;
  totalBytes: number;
}): Promise<string> {
  const { source, at, length, totalBytes } = params;
  const start = Math.max(0, at - SNIPPET_BYTES);
  const end = Math.min(totalBytes, at + length + SNIPPET_BYTES);
  const raw = await source.read({ offset: start, length: end - start });
  const skipped = start === 0 ? 0 : leadingSplit(raw);
  const body = raw.subarray(skipped);
  const bytes = end >= totalBytes ? body : body.subarray(0, completeLength(body));

  return bytes.toString('utf8');
}
