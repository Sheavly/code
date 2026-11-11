import { findSkillMentions } from '@sheavly/workspace/skills/skills.utils';
import { unknownCommand } from './chat.utils.js';
import type { ChatConversation } from './chat.types.js';

/** Finds an unknown leading slash command; skill mentions elsewhere remain prompt text. */
export async function unknownPromptCommand(params: {
  text: string;
  conversation: Pick<ChatConversation, 'skills'>;
}): Promise<string | undefined> {
  const known = new Set((await params.conversation.skills()).map(({ name }) => name));

  return unknownCommand({
    text: params.text,
    unknown: findSkillMentions(params.text)
      .map(({ name }) => name)
      .filter((name) => !known.has(name)),
  });
}
