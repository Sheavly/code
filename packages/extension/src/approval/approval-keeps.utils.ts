import type { AllowEntry } from '@sheavly/protocol/permission/permission.types';
import { MAX_KEEP_ENTRY_CHARS, MAX_REQUEST_KEEPS } from './approval-keeps.constants.js';

/**
 * Whether `keeps` is within what an approval request may keep: at most 20 entries, each at most
 * 500 characters. The host's approvals scope refuses a request over these limits, so a caller that
 * proposes entries it computed itself asks this first and, when they do not fit, asks without
 * keeping anything.
 */
export function keepsFit(keeps: readonly AllowEntry[]): boolean {
  return (
    keeps.length <= MAX_REQUEST_KEEPS && keeps.every((keep) => keep.length <= MAX_KEEP_ENTRY_CHARS)
  );
}
