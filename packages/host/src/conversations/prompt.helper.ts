import type { SendPromptRequest } from '@sheavly/protocol/server/server.types';
import type { ConversationSkills, PreparedPrompt } from './conversations.types.js';
import { ConversationsError } from '../errors/conversations.errors.js';

/** Expands skills identically for a new prompt and in-flight user steering. */
export async function preparePrompt(params: {
  prompt: SendPromptRequest;
  skills?: ConversationSkills | undefined;
  signal?: AbortSignal | undefined;
}): Promise<Extract<PreparedPrompt, { text: string }>> {
  const { prompt, skills, signal } = params;
  const prepared = skills
    ? await skills.prepare({ prompt, signal })
    : {
        text:
          'text' in prompt
            ? prompt.text
            : prompt.parts
                .map((part) => (part.type === 'text' ? part.text : `/${part.name}`))
                .join(''),
      };

  if ('unknown' in prepared) {
    throw new ConversationsError({
      reason: 'unknown_skill',
      message: `No skill is called ${prepared.unknown.join(', ')}: refresh the skills list`,
    });
  }

  return prepared;
}
