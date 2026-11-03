import { completeSkillMention } from '@sheavly/workspace/skills/skills.utils';
import type { Skill } from '@sheavly/workspace/skills/skills.types';
import { CHAT_COMMANDS, EXIT_COMMANDS } from './chat.constants.js';
import type { ModelChoice } from '../harness/harness.types.js';
import type { ChatInput } from './chat.types.js';

/**
 * Reads one line of chat input: the chat's own commands, or a message to send. A message can
 * mention skills (`/<name>`) anywhere in it; `skillRequest` runs them.
 */
export function parseChatInput(line: string): ChatInput {
  const text = line.trim();

  if (text === '') return { kind: 'empty' };
  if (EXIT_COMMANDS.includes(text)) return { kind: 'exit' };
  if (text === '/help') return { kind: 'help' };

  const [command, ...rest] = text.split(/\s+/);

  if (command === '/model' && rest.length <= 1) return { kind: 'model', name: rest[0] };

  return { kind: 'prompt', text };
}

/**
 * The command a message that ran no skill starts with, when no skill has that name (`/nope do
 * this`): a typo is reported, not sent. A mention later in the text is sent as it is.
 */
export function unknownCommand(params: { text: string; unknown: string[] }): string | undefined {
  const { text, unknown } = params;

  return unknown.find((name) => new RegExp(`^/${name}(\\s|$)`).test(text));
}

/** What `/model` prints: each model in `MODELS`, the active one marked. */
export function listModels(params: { choices: ModelChoice[]; active: string | undefined }): string {
  const { choices, active } = params;

  return choices
    .map(
      ({ name, adapter, model }) => `${name === active ? '●' : '○'} ${name}: ${adapter} / ${model}`,
    )
    .join('\n');
}

/**
 * Tab completion for the chat line (readline's `[completions, replaced]`): the `/<partial>` just
 * before the cursor completes to the skills that fit, and, at the start of the line, to the chat's
 * own commands too. `before` is the line up to the cursor. Nothing to offer is `[[], before]`.
 */
export function completeChatLine(params: { before: string; skills: Skill[] }): [string[], string] {
  const { before, skills } = params;
  const completion = completeSkillMention({ text: before, cursor: before.length, skills });

  if (!completion) return [[], before];

  const typed = before.slice(completion.start);
  const commands = completion.start === 0 ? CHAT_COMMANDS.filter((c) => c.startsWith(typed)) : [];

  return [[...commands, ...completion.matches.map(({ name }) => `/${name}`)], typed];
}
