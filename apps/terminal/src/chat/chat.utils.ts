import { completeSkillMention } from '@sheavly/workspace/skills/skills.utils';
import { CHAT_COMMANDS, EXIT_COMMANDS } from './chat.constants.js';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
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
  if (command === '/mode' && rest.length <= 1) return { kind: 'mode', name: rest[0] };
  if (command === '/changes') return { kind: 'changes', target: rest.join(' ') || undefined };
  if (command === '/errors') return { kind: 'errors', target: rest.join(' ') || undefined };

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

/** What `/model` prints: each model of the profile, the active one marked, with the id to switch by. */
export function listModels(params: {
  choices: ModelChoice[];
  active: ModelId | undefined;
}): string {
  const { choices, active } = params;

  return choices
    .map(
      ({ id, name, adapter, model }) =>
        `${id === active ? '●' : '○'} ${name}: ${adapter} / ${model} (${id})`,
    )
    .join('\n');
}

/**
 * Which model the user means by what they typed after `/model`: an id picks that model, and a
 * label picks the model it names. Only the id is the model; a label is a way to find it, so a
 * label two models share picks none (`ambiguous`, with those models) and the user is asked for
 * the id. The reply carries the id the switch is sent with.
 */
export function pickModel(params: {
  choices: ModelChoice[];
  typed: string;
}):
  | { kind: 'found'; choice: ModelChoice }
  | { kind: 'ambiguous'; choices: ModelChoice[] }
  | { kind: 'none' } {
  const { choices, typed } = params;
  const byId = choices.find((choice) => choice.id === typed);

  if (byId) return { kind: 'found', choice: byId };

  const [first, ...others] = choices.filter((choice) => choice.name === typed);

  if (first && others.length === 0) return { kind: 'found', choice: first };
  if (first) return { kind: 'ambiguous', choices: [first, ...others] };

  return { kind: 'none' };
}

/**
 * Tab completion for the chat line (readline's `[completions, replaced]`): the `/<partial>` just
 * before the cursor completes to the skills that fit, and, at the start of the line, to the chat's
 * own commands too. `before` is the line up to the cursor. Nothing to offer is `[[], before]`.
 */
export function completeChatLine(params: {
  before: string;
  skills: SkillInfo[];
}): [string[], string] {
  const { before, skills } = params;
  const completion = completeSkillMention({ text: before, cursor: before.length, skills });

  if (!completion) return [[], before];

  const typed = before.slice(completion.start);
  const commands = completion.start === 0 ? CHAT_COMMANDS.filter((c) => c.startsWith(typed)) : [];

  return [[...commands, ...completion.matches.map(({ name }) => `/${name}`)], typed];
}
