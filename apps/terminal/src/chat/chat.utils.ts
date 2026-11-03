import { EXIT_COMMANDS } from './chat.constants.js';
import type { ChatInput } from './chat.types.js';

/** Reads one line of chat input. */
export function parseChatInput(line: string): ChatInput {
  const text = line.trim();

  if (text === '') return { kind: 'empty' };
  if (!text.startsWith('/')) return { kind: 'prompt', text };
  if (EXIT_COMMANDS.includes(text)) return { kind: 'exit' };
  if (text === '/help') return { kind: 'help' };

  return { kind: 'unknown', command: text };
}
