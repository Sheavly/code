import { stripVTControlCharacters } from 'node:util';
import type { RunningTool } from '../render/render.types.js';
import { oneLine } from '../render/render.utils.js';
import { bold } from '../render/style.utils.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import type { ApprovalPrompt } from './approval-prompt.service.js';
import type { StatusInfo } from './tui.types.js';
import { usageText } from '../usage/usage.utils.js';
import { approvalLiteral } from './approval-literal.utils.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';

const ECHO_MAX_LINES = 12;
/** The longest a running step's description is before the indicator cuts it. */
const RUNNING_TOOL_MAX = 40;

/**
 * A message the user sent, as the conversation shows it: a blank line, the text after a `›`, and
 * a blank line. A long one (a pasted file) shows its first lines and how many were left out.
 */
export function echoText(params: { text: string; palette?: Palette }): string {
  const { text, palette = defaultPalette } = params;
  const lines = plainTerminalText(text).trim().split('\n');
  const shown = lines.slice(0, ECHO_MAX_LINES);
  const hidden = lines.length - shown.length;
  const body = shown.map((line, index) =>
    index === 0 ? `${palette.paint.text.accent(bold('›'))} ${bold(line)}` : `  ${bold(line)}`,
  );

  if (hidden > 0) body.push(palette.paint.text.secondary(`  … ${String(hidden)} more lines`));

  return ['', ...body, ''].join('\n');
}

/**
 * What the approval question looks like: the command, why it is asked, the options with the
 * picked one marked, and the keys. Nothing is marked until the user moves to a choice, so it is
 * plain which one Enter would answer (none, at first).
 */
export function approvalText(params: { prompt: ApprovalPrompt; palette?: Palette }): string {
  const { prompt, palette = defaultPalette } = params;
  const { accent, secondary } = palette.paint.text;
  const request = prompt.current;

  if (!request) return '';
  const command = approvalLiteral(request.command);

  if (prompt.phase === 'message') {
    return [
      bold(`Skip ${command}`),
      'Type what it should do instead, then Enter to send it. Esc goes back.',
    ].join('\n');
  }

  const reasons = request.concerns.map(({ argument, reason }) =>
    secondary(`  ${approvalLiteral(argument)}: ${approvalLiteral(reason)}`),
  );
  const choices = prompt.choices.map(({ label, hint }, index) => {
    const mark = prompt.picked === index ? accent('→') : ' ';
    const name = prompt.picked === index ? accent(bold(label)) : label;

    return `${mark} ${String(index + 1)}. ${name}  ${secondary(approvalLiteral(hint))}`;
  });
  const waiting = prompt.waiting > 0 ? ` · +${String(prompt.waiting)} more waiting` : '';

  return [
    bold(`Run ${command}?`),
    ...reasons,
    ...choices,
    secondary(
      `↑↓ or 1-${String(choices.length)} to choose · Enter to confirm · Esc to skip${waiting}`,
    ),
  ].join('\n');
}

/** The lines typed while a prompt runs, waiting their turn; empty when none wait. */
export function queueText(params: { queue: readonly string[]; palette?: Palette }): string {
  const { queue, palette = defaultPalette } = params;

  if (queue.length === 0) return '';

  const shown = queue.map((line) => {
    const text = plainTerminalText(line);

    return `"${text.length > 40 ? `${text.slice(0, 39)}…` : text}"`;
  });

  return palette.paint.text.secondary(`⏳ ${String(queue.length)} queued: ${shown.join(', ')}`);
}

/**
 * What the working indicator says about the tools running at `at` (epoch milliseconds): the step
 * and how long it has run, or how many run and how long the oldest has. Plain text, with the
 * seconds floored like the prompt's own clock; undefined when none run.
 */
export function runningToolsText(params: {
  tools: readonly RunningTool[];
  at: number;
}): string | undefined {
  const { tools, at } = params;
  const [oldest] = tools;

  if (oldest === undefined) return undefined;

  const elapsed = Math.floor(Math.max(0, at - oldest.startedAt) / 1000);
  const what =
    tools.length === 1
      ? oneLine({ text: stripVTControlCharacters(oldest.description), max: RUNNING_TOOL_MAX })
      : `${String(tools.length)} tools`;

  return `⏺ ${what} ${String(elapsed)}s`;
}

/** The line under the conversation: what it is doing, the model, the permission mode, tasks. */
export function statusText(params: { info: StatusInfo; palette?: Palette }): string {
  const { info, palette = defaultPalette } = params;
  const { text, status } = palette.paint;
  const state = {
    ready: status.success('● ready'),
    working: status.warning('● working'),
    waiting: status.warning('● waiting for you'),
  }[info.state];
  const tasks = info.tasks > 0 ? ` · ${String(info.tasks)} running in background` : '';
  const mode = info.mode === 'allow_all' ? status.error('allow all') : info.mode;

  const effort = info.modelMode ? ` · ${info.modelMode}` : '';

  const usage = info.usage ? ` · ${usageText(info.usage)}` : '';

  return `${state}${text.secondary(` · ${plainTerminalText(info.model)}${effort} · mode: `)}${mode}${text.secondary(tasks + usage)}`;
}
