import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import type {
  ConversationSkills,
  LiveConversation,
} from '@sheavly/host/conversations/conversations.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { Message } from '@sheavly/protocol/message/message.types';
import { UnknownSkillError } from '@sheavly/workspace/errors/skills.errors';
import { skillRequest } from '@sheavly/workspace/skills/skill-files.helper';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import { MAX_TURNS } from './harness.constants.js';
import type { TerminalHarness } from './harness.types.js';

/**
 * A workspace's skills as a conversation offers them: the list for a `/` menu, and each prompt
 * prepared by `skillRequest` (text mentions or picked parts). A picked skill no one has is
 * reported, not thrown, so the host refuses the prompt with `unknown_skill`.
 */
export function workspaceSkills(roots: SkillRoots): ConversationSkills {
  return {
    list: async ({ signal }) => {
      const { skills } = await findSkills({ ...roots, ...(signal && { signal }) });

      return skills.map(({ name, description, manualOnly, scope }) => ({
        name,
        description,
        manualOnly,
        scope,
      }));
    },
    prepare: async ({ prompt, signal }) => {
      try {
        const { text, parts } = await skillRequest({ ...roots, prompt, ...(signal && { signal }) });

        return { text, parts };
      } catch (caughtError) {
        if (caughtError instanceof UnknownSkillError) return { unknown: caughtError.skills };
        throw caughtError;
      }
    },
  };
}

/**
 * One conversation on a terminal harness, as the chat and the server both run it: its tools and
 * hooks, the workspace's skills, and closing stops its background commands. `messages` is
 * history to continue from.
 */
export function terminalConversation(params: {
  harness: TerminalHarness;
  messages?: Message[] | undefined;
}): LiveConversation {
  const { harness, messages } = params;

  return {
    harness,
    conversation: createConversation({
      harness,
      run: streamAgent,
      tools: harness.tools,
      hooks: harness.hooks,
      maxTurns: MAX_TURNS,
      ...(messages && { messages }),
    }),
    skills: workspaceSkills(harness.skills),
  };
}
