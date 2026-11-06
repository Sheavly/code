import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import type {
  ConversationRun,
  ConversationSkills,
  ConversationStorage,
  LiveConversation,
} from '@sheavly/host/conversations/conversations.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { Message } from '@sheavly/protocol/message/message.types';
import { UnknownSkillError } from '@sheavly/workspace/errors/skills.errors';
import { skillRequest } from '@sheavly/workspace/skills/skill-files.helper';
import { findSkills } from '@sheavly/workspace/skills/skills.helper';
import type { SkillRoots } from '@sheavly/workspace/skills/skills.types';
import type { BackendHarness } from './harness.types.js';

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
 * One conversation on a backend harness: its tools and hooks, the
 * workspace's skills, at most `maxTurns` turns a prompt (no limit without it), each prompt's `done` waiting for its
 * background tasks with `waitForTasks`. Closing it stops its background commands. `messages` is
 * history to continue from, and `run` what the app says the run is, the model it is on included.
 */
export function harnessConversation(params: {
  harness: BackendHarness;
  run: ConversationRun;
  messages?: Message[] | undefined;
  /** Where the host keeps this conversation (see `ConversationStorage`); none keeps nothing. */
  storage?: ConversationStorage | undefined;
  maxTurns?: number;
  waitForTasks?: boolean;
}): LiveConversation {
  const { harness, run, messages, storage, maxTurns, waitForTasks = false } = params;

  return {
    harness,
    conversation: createConversation({
      harness,
      run: streamAgent,
      tools: harness.tools,
      hooks: harness.hooks,
      ...(maxTurns !== undefined && { maxTurns }),
      waitForTasks,
      ...(messages && { messages }),
      ...(storage && {
        keepHistory: storage.keepHistory,
        // A reopened conversation's session already ran its `sessionStart` hooks.
        resumed: storage.resume !== undefined,
      }),
    }),
    skills: workspaceSkills(harness.skills),
    run,
  };
}
