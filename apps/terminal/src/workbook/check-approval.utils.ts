import { allowEntryBase, commandBase } from '@sheavly/coding/run-command/command-base.utils';
import { parseCommand } from '@sheavly/coding/run-command/allow-list.utils';
import type { ApprovalRequest, ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import { COMMAND_TOOL_NAMES, NOT_ALLOWED } from '@sheavly/coding/run-command/run-command.constants';
import type { RunExpectation } from './check.types.js';

/** Batch command authorization never overrides a step that explicitly forbids command requests. */
export function stepApprovedCommands(params: {
  step: RunExpectation;
  approvedCommands: readonly string[];
}): readonly string[] {
  const forbidden = params.step.forbid?.tools ?? [];

  return COMMAND_TOOL_NAMES.some((tool) => forbidden.includes(tool)) ? [] : params.approvedCommands;
}

function authorizedArguments(params: {
  line: string;
  approvedCommands: readonly string[];
}): string[] | undefined {
  const parsed = parseCommand(params.line);

  if (
    !parsed.ok ||
    parsed.steps.length === 0 ||
    !parsed.steps.every(({ argv }) => params.approvedCommands.includes(commandBase(argv).join(' ')))
  ) {
    return undefined;
  }

  // Concerns use argv.join(' '), which loses quoting. Match that structured display rather
  // than parsing it as a new command and mistaking quoted Node code for shell operators.
  return parsed.steps.map(({ argv }) => argv.join(' '));
}

/** Unknown concerns are denied even if the displayed command itself is authorized. */
export function checkApprovalResponse(params: {
  request: ApprovalRequest;
  approvedCommands: readonly string[];
}): ApprovalResponse {
  const { request, approvedCommands } = params;

  const argumentsAsked = authorizedArguments({ line: request.command, approvedCommands });

  const isCommandTool = COMMAND_TOOL_NAMES.some((tool) => tool === request.tool);

  if (!isCommandTool || !argumentsAsked) return { decision: 'skip' };

  const ordinary =
    request.concerns.length > 0 &&
    request.concerns.every(
      ({ argument, reason }) =>
        Object.values(NOT_ALLOWED).includes(reason) && argumentsAsked.includes(argument),
    );
  const keepsAuthorized =
    request.keeps === undefined ||
    request.keeps.every((entry) => approvedCommands.includes(allowEntryBase(entry).join(' ')));

  if (!ordinary || !keepsAuthorized) return { decision: 'skip' };

  if (request.options.includes('allow_session') && request.keeps?.length) {
    return { decision: 'allow_session' };
  }

  return { decision: request.options.includes('approve') ? 'approve' : 'skip' };
}
