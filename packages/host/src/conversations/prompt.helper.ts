import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { SendPromptRequest } from '@sheavly/protocol/server/server.types';
import type { ConversationSkills, PreparedPrompt } from './conversations.types.js';
import { ConversationsError } from '../errors/conversations.errors.js';

/** Expands skills identically for a new prompt and in-flight user steering. */
async function preparePrompt(params: {
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

/**
 * Refuses a send while another prompt of the conversation is still preparing or running, so it
 * cannot take over that prompt's stop switch. Throws `session_running`, as the conversation does.
 */
export function refuseOverlappingSend(sessionId: SessionId): never {
  throw new SessionError({
    reason: 'session_running',
    sessionId,
    message: 'A prompt is still running in this conversation: wait for it to finish, or stop it',
  });
}

/**
 * Prepares a prompt for sending, lets a wake run end so the prompt is the next one, then starts
 * it with `start`. The caller's stop switch is already registered, so a stop meanwhile aborts
 * `signal`; `onFailure` runs when any step throws (`start` included, which refuses a busy
 * conversation), because nothing iterates events to release the switch on that path.
 */
export async function prepareForSend(params: {
  prompt: SendPromptRequest;
  skills?: ConversationSkills | undefined;
  signal: AbortSignal;
  assertHealthy: () => void;
  settleWake: () => Promise<void>;
  start: (prepared: Extract<PreparedPrompt, { text: string }>) => AsyncIterable<AgentEvent>;
  onFailure: () => void;
}): Promise<{
  prepared: Extract<PreparedPrompt, { text: string }>;
  events: AsyncIterable<AgentEvent>;
}> {
  const { prompt, skills, signal, assertHealthy, settleWake, start, onFailure } = params;

  try {
    const prepared = await preparePrompt({ prompt, skills, signal });

    assertHealthy();
    // A run the conversation started for finished work ends first, so the user's line is the
    // next prompt rather than refused as `session_running`.
    await settleWake();

    return { prepared, events: start(prepared) };
  } catch (caughtError) {
    onFailure();
    throw caughtError;
  }
}
