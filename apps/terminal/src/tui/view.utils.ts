import { styleText } from 'node:util';
import type { ApprovalPrompt } from './approval-prompt.service.js';
import type { StatusInfo } from './tui.types.js';

type Style = Parameters<typeof styleText>[0];

// The screen writes to its own terminal through pi-tui, not to stdout, so whether stdout is a
// terminal says nothing about it: always style.
const styled = (format: Style) => (text: string) =>
  styleText(format, text, { validateStream: false });
const gray = styled('gray');
const bold = styled('bold');
const cyan = styled('cyan');
const cyanBold = styled(['cyan', 'bold']);
const green = styled('green');
const yellow = styled('yellow');
const red = styled('red');

/**
 * What the approval question looks like: the command, why it is asked, the options with the
 * picked one marked, and the keys. Nothing is marked until the user moves to a choice, so it is
 * plain which one Enter would answer (none, at first).
 */
export function approvalText(prompt: ApprovalPrompt): string {
  const request = prompt.current;

  if (!request) return '';

  if (prompt.phase === 'message') {
    return [
      bold(`Skip ${request.command}`),
      'Type what it should do instead, then Enter to send it. Esc goes back.',
    ].join('\n');
  }

  const reasons = request.concerns.map(({ argument, reason }) => gray(`  ${argument}: ${reason}`));
  const choices = prompt.choices.map(({ label, hint }, index) => {
    const mark = prompt.picked === index ? cyan('→') : ' ';
    const name = prompt.picked === index ? cyanBold(label) : label;

    return `${mark} ${String(index + 1)}. ${name}  ${gray(hint)}`;
  });
  const waiting = prompt.waiting > 0 ? ` · +${String(prompt.waiting)} more waiting` : '';

  return [
    bold(`Run ${request.command}?`),
    ...reasons,
    ...choices,
    gray(`↑↓ or 1-${String(choices.length)} to choose · Enter to confirm · Esc to skip${waiting}`),
  ].join('\n');
}

/** The lines typed while a prompt runs, waiting their turn; empty when none wait. */
export function queueText(queue: readonly string[]): string {
  if (queue.length === 0) return '';

  const shown = queue.map((line) => `"${line.length > 40 ? `${line.slice(0, 39)}…` : line}"`);

  return gray(`⏳ ${String(queue.length)} queued: ${shown.join(', ')}`);
}

/** The line under the conversation: what it is doing, the model, the permission mode, tasks. */
export function statusText(info: StatusInfo): string {
  const state = {
    ready: green('● ready'),
    working: yellow('● working'),
    waiting: yellow('● waiting for you'),
  }[info.state];
  const tasks = info.tasks > 0 ? ` · ${String(info.tasks)} running in background` : '';
  const mode = info.mode === 'allow_all' ? red('allow all') : info.mode;

  return `${state}${gray(` · ${info.model} · mode: `)}${mode}${gray(tasks)}`;
}
