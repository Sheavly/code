import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { answeringUi } from '@sheavly/runtime/testing/approvals.fake';
import { parseCommand } from '../run-command/allow-list.utils.js';
import { confirmCommand } from '../run-command/command-approval.helper.js';
import type { CommandPermissions } from '../run-command/run-command.types.js';

/** Exercises approval decisions without executing the command or requiring a real Git repository. */
export function commandConfirmer() {
  return async (
    command: string,
    permissions: CommandPermissions,
    ui: ReturnType<typeof answeringUi>,
  ): Promise<void> => {
    const parsed = parseCommand(command);

    if (!parsed.ok) throw new Error(parsed.reason);

    await confirmCommand({
      command,
      steps: parsed.steps,
      permissions,
      approvals: ui.approvals,
      call: { callId: callIdSchema.parse('approval-test') },
      signal: new AbortController().signal,
    });
  };
}
