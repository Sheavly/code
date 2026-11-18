import { isFileChange } from '@sheavly/coding/files/files.utils';
import { isFileRead } from '@sheavly/coding/read-file/read-file.utils';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { ChangeLog } from '../changes/change-log.service.js';
import type { FailureLog } from '../failures/failure-log.service.js';
import type { Look, ToolResultLines } from './render.types.js';
import { commandOf, describeRead, firstLine, ownLine, seconds } from './render.utils.js';
import { plainTerminalText } from './terminal-text.utils.js';

/**
 * The lines a finished tool call is drawn as, in order: its result, then the file change or the
 * collapsed failure under it. Keeps the change or failure in its log when it has one, so it can
 * be expanded later, and says which of the two the newest collapsed line stands for. `label` is
 * the step's title when the look does not pair steps. A result that is not a tool message has no
 * lines.
 */
export function drawToolResult(params: {
  event: Extract<EntryEvent, { type: 'tool_result' }>;
  look: Look;
  label: string;
  changes: ChangeLog;
  failures: FailureLog;
}): ToolResultLines {
  const { event, look, label, changes, failures } = params;
  const { message, description, durationMs, artifacts = [] } = event;

  if (message.role !== 'tool') return { lines: [], latest: undefined };

  const change = artifacts.find(isFileChange);
  const read = artifacts.find(isFileRead);
  // A file tool's own line ("Edited a.ts (1 → 2 lines)"). A hook can append a long report to the
  // result for the model; the terminal shows the tool's line and how much more there is, and the
  // diff follows below.
  const summary = change ? ownLine(message.content) : `${message.content.length} chars`;
  const detail = message.isError
    ? firstLine(message.content)
    : ((read && describeRead(read)) ?? summary);
  const result = look.toolResult({
    ok: !message.isError,
    label,
    detail: plainTerminalText(detail),
    seconds: seconds(durationMs),
  });

  if (message.isError) {
    // Keeps a failed step's message when it says more than its line, and shows it collapsed.
    const command = commandOf(event.call);
    const title = command ? `${description}  $ ${command}` : description;
    const failure = failures.keep({ title, content: message.content });

    return failure
      ? { lines: [result, look.failure(failure)], latest: 'failure' }
      : { lines: [result], latest: undefined };
  }

  const edit = change && changes.keep(change);

  return edit
    ? { lines: [result, look.fileChange(edit)], latest: 'change' }
    : { lines: [result], latest: undefined };
}
