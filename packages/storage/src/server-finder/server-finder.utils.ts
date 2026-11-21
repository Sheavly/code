import type { ReadResult } from '../discovery-file/discovery-file.types.js';
import {
  MAX_VERDICT_TEXT_LENGTH,
  NAMEABLE_FAILURES,
  UNKNOWN_FAILURE,
  UNPRINTABLE_TEXT,
} from './server-finder.constants.js';
import type {
  FinderVerifyResult,
  FoundServer,
  Reason,
  SimpleProblem,
} from './server-finder.types.js';

type Simple = Exclude<SimpleProblem, 'no-answer'>;

/** The name of `failure` when it is one of the allow-listed kinds; reading it never throws. */
function nameableKind(failure: unknown): string {
  try {
    const name: unknown = failure instanceof Error ? failure.name : undefined;

    return typeof name === 'string' && NAMEABLE_FAILURES.includes(name) ? name : UNKNOWN_FAILURE;
  } catch (caughtError) {
    // A name that cannot be read is hostile: what it threw is dropped, it could hold the token.
    const _dropped = caughtError;

    return UNKNOWN_FAILURE;
  }
}

/**
 * The reason a handshake that threw gives. Only an allow-listed kind of failure is named: its name
 * or message could quote the address or the token.
 */
export function noAnswerReason(params: { directory: string; failure: unknown }): Reason {
  const { directory, failure } = params;
  const kind = nameableKind(failure);

  return {
    directory,
    problem: 'no-answer',
    message: `The server of ${directory} did not answer the handshake (${kind}); nothing secret was sent to it.`,
  };
}

type Claimed = Partial<
  Record<'status' | 'protocolVersion' | 'older' | 'client' | 'server' | 'message', unknown>
>;

/** Whether a handshake text is short and free of characters that could steer a terminal. */
function isPrintable(field: string): boolean {
  return field.length <= MAX_VERDICT_TEXT_LENGTH && !UNPRINTABLE_TEXT.test(field);
}

/** Calls the caller's `log`; whatever it throws is dropped, it could hold the token. */
export function safeLog(params: { log: ((line: string) => void) | undefined; line: string }): void {
  const { log, line } = params;

  try {
    log?.(line);
  } catch (caughtError) {
    const _dropped = caughtError;
  }
}

function checkedVerdict(params: { value: unknown; token: string }): FinderVerifyResult | undefined {
  const { value, token } = params;

  if (typeof value !== 'object' || value === null) return undefined;

  const claimed: Claimed = value;
  const { status, older } = claimed;
  const text = (field: unknown): string | undefined =>
    typeof field === 'string' && isPrintable(field) && !field.includes(token) ? field : undefined;

  if (status === 'wrong_server') return { status };

  if (status === 'no_handshake') return { status };

  const protocolVersion = text(claimed.protocolVersion);

  if (status === 'verified') {
    return protocolVersion === undefined ? undefined : { status, protocolVersion };
  }

  const [client, server, message] = [
    text(claimed.client),
    text(claimed.server),
    text(claimed.message),
  ];

  if (status !== 'version_mismatch') return undefined;

  if (client === undefined || server === undefined || message === undefined) return undefined;

  if (older !== 'client' && older !== 'server') return undefined;

  return { status, older, client, server, message };
}

/**
 * The verdict `value` is, rebuilt field by field, or `undefined` when it is not one of the four
 * shapes: whatever else an injected handshake holds (extra fields, a getter that throws, a text
 * that quotes the token) never reaches a result.
 */
export function readVerdict(params: {
  value: unknown;
  token: string;
}): FinderVerifyResult | undefined {
  try {
    return checkedVerdict(params);
  } catch (caughtError) {
    // A verdict that cannot be read is hostile: what it threw is dropped, it could hold the token.
    const _dropped = caughtError;

    return undefined;
  }
}

/** A reason that needs nothing beyond the folder; the message says what to do about it. */
export function simpleReason(params: { directory: string; problem: Simple }): Reason {
  const { directory, problem } = params;

  return { directory, problem, message: simpleMessage({ directory, problem }) };
}

function simpleMessage(params: { directory: string; problem: Simple }): string {
  const { directory, problem } = params;

  switch (problem) {
    case 'no-file':
      return `No discovery file in ${directory}.`;
    case 'invalid':
      return `The discovery file in ${directory} is not one of this format; it was not used.`;
    case 'newer-format':
      return `The discovery file in ${directory} was written by a newer Sheavly; update this client.`;
    case 'stale':
      return `The discovery file in ${directory} is left over: its server is gone (the lock is free).`;
    case 'lock-inconclusive':
      return `Could not tell whether the server of ${directory} is running (the lock did not answer); it was not contacted.`;
    case 'wrong-server':
      return `What listens at the address in ${directory} did not prove it is the server that wrote the file; nothing secret was sent to it.`;
    case 'no-handshake':
      return `What listens at the address in ${directory} has no handshake, so it is not this server; nothing secret was sent to it.`;
  }
}

/**
 * The reason a read that gave no file gives. The file's text and the reader's error never reach
 * the message: a refusal is named by its kind alone.
 */
export function readReason(params: {
  directory: string;
  read: Exclude<ReadResult, { status: 'found' }>;
}): Reason {
  const { directory, read } = params;

  if (read.status === 'none') return simpleReason({ directory, problem: 'no-file' });

  if (read.status === 'invalid') return simpleReason({ directory, problem: 'invalid' });

  if (read.status === 'newer') return simpleReason({ directory, problem: 'newer-format' });

  const detail = read.reason === 'folder' ? read.detail : undefined;

  return {
    directory,
    problem: 'refused',
    refusal: read.reason,
    ...(detail !== undefined && { detail }),
    message: `The discovery file in ${directory} was refused (${detail ?? read.reason}); it was not read or used.`,
  };
}

/**
 * The lines a command prints when no server was found, one per folder looked at, never holding the
 * token or a file's text.
 */
export function describeNone(result: Extract<FoundServer, { status: 'none' }>): string[] {
  if (result.reasons.length === 0) return ['No Sheavly server was found.'];

  return [
    'No running Sheavly server was found:',
    ...result.reasons.map((reason) => `  ${reason.message}`),
  ];
}
