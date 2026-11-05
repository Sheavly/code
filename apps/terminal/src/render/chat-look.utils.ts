import type { Look } from './render.types.js';
import { cyan, gray, green, red, yellow } from './style.utils.js';

/**
 * What a person reading a conversation wants: the reply as plain text, and what the run did
 * around it kept small and dim, one line per step. Counts, ids and the loop's bookkeeping, which
 * the log look prints, are left out; a problem (a failure, a limit) is shown in colour.
 */
export const chatLook: Look = {
  // A blank line between the reply and the steps around it, in both directions.
  gap: ({ from, to, lineOpen }) => {
    if (from === undefined || from === to) return '';
    if (to === 'reply') return '\n';

    return lineOpen ? '\n\n' : '\n';
  },
  toolStarted: ({ description, command }) =>
    `${cyan('⏺')} ${description}${command ? gray(`  $ ${command}`) : ''}\n`,
  parallel: () => '',
  toolResult: ({ ok, label, detail, seconds }) => {
    if (!ok) return `  ${gray('⎿')} ${red(`✗ ${label}${detail}`)} ${gray(`· ${seconds}`)}\n`;

    return `  ${gray('⎿')} ${green('✓')} ${label}${detail} ${gray(`· ${seconds}`)}\n`;
  },
  taskRunning: ({ label, id }) => `  ${gray('↻')} ${label}running in background as ${id}\n`,
  taskCompleted: ({ ok, id, status, exit, elapsed, command, output }) => {
    const mark = ok ? green('✓') : red('✗');
    const head = `${mark} ${id} ${status}${exit} ${gray(`· ${elapsed} · $ ${command}`)}\n`;

    return output ? `${head}  ${gray(`⎿ ${output}`)}\n` : head;
  },
  steer: (firstLine) => `${yellow('✉')} steer: ${firstLine}\n`,
  contextAdded: ({ hook, chars }) => gray(`＋ ${hook} added context (${chars} chars)\n`),
  hookFailed: ({ hook, handler, error }) => red(`✗ hook ${hook} failed in ${handler}: ${error}\n`),
  turnEnd: ({ stopReason, waiting }) => {
    if (stopReason === 'max_tokens') return yellow('⚠ the reply was cut off at the token limit\n');
    if (stopReason !== 'end_turn' || waiting === 0) return '';

    return gray(`… waiting for ${waiting} background task(s) · Ctrl+C to stop\n`);
  },
  done: ({ reason }) => {
    if (reason === 'interrupted') return gray('■ stopped\n');
    if (reason === 'max_turns') return yellow('⚠ stopped at the turn limit\n');

    return '';
  },
  subAgentStarted: ({ indent, title }) => `${indent}${cyan('◆')} ${title} ${gray('started')}\n`,
  subAgentStatus: ({ indent, title, status }) => `${indent}  ${gray(`◇ ${title}: ${status}`)}\n`,
  subAgentMessage: ({ indent, title, content }) =>
    `${indent}  ${gray(`✉ ${title} got a message: ${content}`)}\n`,
  subAgentEnded: ({ indent, title, state }) =>
    `${indent}${cyan('◆')} ${title} ${state === 'completed' ? green(state) : yellow(state)}\n`,
};
