import {
  MAX_KEEP_ENTRY_CHARS,
  MAX_REQUEST_KEEPS,
} from '@sheavly/extension/approval/approval-keeps.constants';
import { keepsFit } from '@sheavly/extension/approval/approval-keeps.utils';
import type { ApprovalOption } from '@sheavly/protocol/approval/approval.types';
import { approvalOptionSchema } from '@sheavly/protocol/approval/approval.validator';
import type { AllowEntry } from '@sheavly/protocol/permission/permission.types';
import { allowEntrySchema } from '@sheavly/protocol/permission/permission.validator';
import { ScopeArgumentError } from '../errors/scopes.errors.js';
import { KEEPING_OPTIONS } from './run-services.constants.js';

/** The `options` of a request, each one of the protocol's: a non-empty list, or a refusal. */
function parseOptions(options: unknown): ApprovalOption[] {
  if (!Array.isArray(options) || options.length === 0) {
    throw new ScopeArgumentError('An approval request\'s "options" must be a non-empty list');
  }

  return (options as unknown[]).map((option) => {
    const parsed = approvalOptionSchema.safeParse(option);

    if (!parsed.success) {
      throw new ScopeArgumentError('An approval request offered an option that does not exist');
    }

    return parsed.data;
  });
}

/** The `keeps` of a request, parsed by the protocol's schema and bounded in count and size. */
function parseKeeps(keeps: unknown): AllowEntry[] {
  if (!Array.isArray(keeps)) {
    throw new ScopeArgumentError('An approval request\'s "keeps" must be a list');
  }

  const parsed = (keeps as unknown[]).map((keep) => {
    const entry = allowEntrySchema.safeParse(keep);

    if (!entry.success) {
      throw new ScopeArgumentError(
        'An approval request kept an entry that is not a valid allow entry',
      );
    }

    return entry.data;
  });

  if (!keepsFit(parsed)) {
    throw new ScopeArgumentError(
      `An approval request may keep at most ${String(MAX_REQUEST_KEEPS)} entries of at most ${String(MAX_KEEP_ENTRY_CHARS)} characters`,
    );
  }

  return parsed;
}

/**
 * What a request with the `approval:keep` grant asks to offer and keep, parsed once: `options`
 * (the registry's default when left out) and `keeps`. Throws `ScopeArgumentError` for an unknown
 * option, a malformed or oversized `keeps`, or `always_allow`/`allow_session` offered without at
 * least one entry to keep, so an answer never grants a rule the user was not shown.
 */
export function parseKeepRequest(params: { options: unknown; keeps: unknown }): {
  options?: ApprovalOption[];
  keeps?: AllowEntry[];
} {
  const options = params.options === undefined ? undefined : parseOptions(params.options);
  const keeps = params.keeps === undefined ? undefined : parseKeeps(params.keeps);

  if (options?.some((option) => KEEPING_OPTIONS.includes(option)) && !keeps?.length) {
    throw new ScopeArgumentError(
      'An approval request that offers always_allow or allow_session must say what it keeps',
    );
  }

  return { ...(options && { options }), ...(keeps && { keeps }) };
}
