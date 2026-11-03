import type { ConversationSkills } from '../conversations/conversations.types.js';

/**
 * Test-only: a conversation's skills as a workspace gives them, where only `review` exists. Text
 * that mentions `/review` runs it; parts that pick any other skill are refused as unknown.
 */
export const reviewSkill: ConversationSkills = {
  list: async () => [
    { name: 'review', description: 'Reviews.', manualOnly: false, scope: 'project' },
  ],
  prepare: async ({ prompt }) => {
    if ('text' in prompt) {
      return prompt.text.includes('/review')
        ? { text: `[review]\n${prompt.text}`, parts: [{ type: 'skill', name: 'review' }] }
        : { text: prompt.text };
    }

    const unknown = prompt.parts.flatMap((part) =>
      part.type === 'skill' && part.name !== 'review' ? [part.name] : [],
    );

    return unknown.length > 0 ? { unknown } : { text: '[review]', parts: prompt.parts };
  },
};
