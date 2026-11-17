import { findSkillMentions } from '@sheavly/coding/skills/skills.utils';
import { unknownCommand } from './chat.utils.js';
import type { ChatConversation } from './chat.types.js';

/** Finds an unknown leading slash command; skill mentions elsewhere remain prompt text. */
export async function unknownPromptCommand(params: {
  text: string;
  conversation: Pick<ChatConversation, 'skills'>;
}): Promise<string | undefined> {
  const mentioned = findSkillMentions(params.text).map(({ name }) => name);

  // A prompt that mentions no skill has nothing to check, so it costs no request.
  if (mentioned.length === 0) return undefined;

  const known = new Set((await params.conversation.skills()).map(({ name }) => name));

  return unknownCommand({
    text: params.text,
    unknown: mentioned.filter((name) => !known.has(name)),
  });
}
