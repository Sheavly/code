import {
  DISCOVERY_FILE_NAME,
  DISCOVERY_MAX_BYTES,
} from '@sheavly/protocol/discovery/discovery.constants';
import {
  discoveryFileSchema,
  peekFormatVersion,
} from '@sheavly/protocol/discovery/discovery.validator';
import { GROUP_AND_OTHERS } from '../json-file/json-file.constants.js';
import { DISCOVERY_TEMP_PATTERN } from './discovery-file.constants.js';
import type { ReadRefusal, ReadResult } from './discovery-file.types.js';

/** The temp name of one publish: unique per process and call, and in the folder of the file. */
export function discoveryTempName(params: { pid: number; nonce: string }): string {
  return `${DISCOVERY_FILE_NAME}.${String(params.pid)}.${params.nonce}.tmp`;
}

/** The pid in a temp file's name, or `undefined` when `name` is not a temp file of a publish. */
export function discoveryTempPid(name: string): number | undefined {
  const match = DISCOVERY_TEMP_PATTERN.exec(name);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * Why an open file is not one to read, from what `fstat` of the handle says; `undefined` when it
 * is a regular file of ours that nobody else can open, and small enough. Where the system has no
 * owners or modes (Windows) only the kind and the size are judged.
 */
export function refuseOpenFile(params: {
  stat: { isFile: boolean; uid: number; mode: number; size: number };
  uid: number;
  platform: NodeJS.Platform;
}): ReadRefusal | undefined {
  const { stat, uid, platform } = params;

  if (!stat.isFile) return { reason: 'not-regular' };

  if (stat.size > DISCOVERY_MAX_BYTES) return { reason: 'too-large' };

  if (platform === 'win32') return undefined;

  if (stat.uid !== uid) return { reason: 'other-owner' };

  return (stat.mode & GROUP_AND_OTHERS) === 0 ? undefined : { reason: 'too-open' };
}

/**
 * What the text of a discovery file is: its value, a later format, or not a discovery file. The
 * text and the validation details never leave this function, since they hold the token.
 */
export function parseDiscoveryText(text: string): ReadResult {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (caughtError) {
    // Only a syntax error means "not JSON"; and its message, which quotes the text, is dropped.
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    return { status: 'invalid' };
  }

  const peek = peekFormatVersion(json);

  if (peek.status === 'newer') return { status: 'newer', formatVersion: peek.formatVersion };

  const parsed = peek.status === 'current' ? discoveryFileSchema.safeParse(json) : undefined;

  return parsed?.success ? { status: 'found', value: parsed.data } : { status: 'invalid' };
}
