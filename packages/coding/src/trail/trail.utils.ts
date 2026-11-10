import { z } from 'zod';
import type { ToolCall } from '@sheavly/protocol/message/message.types';
import { redactDiagnosticText } from '@sheavly/runtime/errors/diagnostic-text.utils';

/** A command longer than this is cut in the trail: what ran matters, not every argument. */
const MAX_COMMAND_CHARS = 120;

/** A path longer than this is cut: a model-written value never grows the trail without bound. */
const MAX_PATH_CHARS = 200;

const pathInput = z.object({ path: z.string().min(1) });
const readInput = pathInput.extend({
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});
const commandInput = z.object({ command: z.string().min(1) });

/**
 * `text` on one line with credential forms redacted, cut at `max` characters and marked. It is
 * cut on code points, so an emoji is never split into a lone surrogate a provider would reject.
 * Empty when there is nothing but whitespace.
 */
function short(params: { text: string; max: number }): string {
  const flat = redactDiagnosticText(params.text.replaceAll(/\s+/g, ' ').trim());
  const points = Array.from(flat);

  return points.length > params.max ? `${points.slice(0, params.max - 1).join('')}…` : flat;
}

/**
 * One short line for a call of the file tools or `run_command`, or nothing for any other call
 * (or one whose input does not fit its tool): the trail of what the work touched, for a summary
 * that must not depend on a model remembering it. A call's arguments are exact where a
 * paraphrase is not, so the line is built from them and never from the model's own words.
 * Pass it as the `extract` of `@sheavly/summary`'s `trailSection`.
 */
export function fileTrail(call: ToolCall): string | undefined {
  switch (call.name) {
    case 'write_file':
      return changeLine({ verb: 'wrote', input: call.input });
    case 'edit_file':
      return changeLine({ verb: 'edited', input: call.input });
    case 'read_file':
      return readLine(call.input);
    case 'run_command':
      return commandLine(call.input);
    default:
      return undefined;
  }
}

/** "wrote src/a.ts", from a call that has a path. */
function changeLine(params: { verb: string; input: unknown }): string | undefined {
  const input = pathInput.safeParse(params.input);

  if (!input.success) return undefined;

  const path = short({ text: input.data.path, max: MAX_PATH_CHARS });

  return path ? `${params.verb} ${path}` : undefined;
}

/** "read src/a.ts", with the lines when only part was read. */
function readLine(rawInput: unknown): string | undefined {
  const input = readInput.safeParse(rawInput);

  if (!input.success) return undefined;

  const { startLine, endLine } = input.data;
  const path = short({ text: input.data.path, max: MAX_PATH_CHARS });
  const whole = startLine === undefined && endLine === undefined;
  const lines = whole ? '' : ` lines ${startLine ?? 1}–${endLine ?? 'end'}`;

  return path ? `read ${path}${lines}` : undefined;
}

/** "ran: npm test". No code span around it: a backtick in the command would close one early. */
function commandLine(rawInput: unknown): string | undefined {
  const input = commandInput.safeParse(rawInput);

  if (!input.success) return undefined;

  const command = short({ text: input.data.command, max: MAX_COMMAND_CHARS });

  return command ? `ran: ${command}` : undefined;
}
