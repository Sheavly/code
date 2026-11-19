import type { ApprovalOption } from '@sheavly/protocol/approval/approval.types';

/**
 * At most this many concerns reach the user from one request. A request with more keeps the first
 * one fewer and ends with a concern saying how many are not shown.
 */
export const MAX_REQUEST_CONCERNS = 50;

/** The options whose answer keeps something, so a request offering one must say what. */
export const KEEPING_OPTIONS: readonly ApprovalOption[] = ['always_allow', 'allow_session'];

/** The longest `argument` or `reason` a concern keeps, in characters; a longer one ends with `…`. */
export const MAX_CONCERN_TEXT_CHARS = 1000;

/** The UTF-16 code units that open a surrogate pair: a cut text must not end in one. */
export const HIGH_SURROGATE_FIRST = 0xd800;

export const HIGH_SURROGATE_LAST = 0xdbff;
