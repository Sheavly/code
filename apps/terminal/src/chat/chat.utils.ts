import { EXIT_COMMANDS } from './chat.constants.js';
import type { ModelChoice } from '../harness/harness.types.js';
import type { ChatInput } from './chat.types.js';

/** Reads one line of chat input. */
export function parseChatInput(line: string): ChatInput {
  const text = line.trim();

  if (text === '') return { kind: 'empty' };
  if (!text.startsWith('/')) return { kind: 'prompt', text };
  if (EXIT_COMMANDS.includes(text)) return { kind: 'exit' };
  if (text === '/help') return { kind: 'help' };

  const [command, ...rest] = text.split(/\s+/);

  if (command === '/model' && rest.length <= 1) return { kind: 'model', name: rest[0] };

  return { kind: 'unknown', command: text };
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
