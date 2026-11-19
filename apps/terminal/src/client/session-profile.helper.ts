import { createClient } from '@sheavly/client/client/client.helper';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import { SetupError } from '../errors/setup.errors.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';
import type { Backend } from './client.types.js';

/**
 * The profile a new conversation starts on: the requested one once it is known to be ready.
 * Undefined when none was asked for, and when resuming, which keeps the conversation's own profile
 * (a differing request is said to be ignored, through `write`). Reads only: the run must change no
 * profile and no config. Throws `SetupError` for an unknown or unready profile, so a wrong id
 * fails before anything opens and never falls back to another profile.
 */
export async function settleProfile(params: {
  backend: Backend;
  resume: ConversationId | undefined;
  requested: ProfileId | undefined;
  write: (text: string) => void;
}): Promise<ProfileId | undefined> {
  const { backend, resume, requested, write } = params;

  if (!requested) return undefined;

  if (resume) {
    const notice = await ignoredProfileNotice({ backend, resume, requested });

    if (notice) write(notice);

    return undefined;
  }

  await requireReadyProfile({ backend, profile: requested });

  return requested;
}

async function requireReadyProfile(params: { backend: Backend; profile: ProfileId }) {
  const { backend, profile } = params;
  const found = await profileOf({ backend, profile });

  if (!found) throw new SetupError(`There is no profile ${profile}`);

  if (!found.ready) {
    throw new SetupError(
      `Profile ${plainTerminalText(found.name)} (${profile}) is not ready: it has no usable model or key. Run --setup without --profile to finish it.`,
    );
  }
}

/**
 * The note for `--resume` with a `--profile` that is not the conversation's own: a stored
 * conversation keeps the profile it started on, so the flag is ignored. Undefined when it agrees,
 * or when the conversation is not stored (reopening it fails with its own message).
 */
async function ignoredProfileNotice(params: {
  backend: Backend;
  resume: ConversationId;
  requested: ProfileId;
}): Promise<string | undefined> {
  const { backend, resume, requested } = params;
  const { conversations } = await createClient(backend).call('queryStoredConversations', {
    body: {},
  });
  const stored = conversations.find(({ id }) => id === resume);

  if (!stored || stored.profile === requested) return undefined;

  return `→ conversation ${resume} runs on its own profile ${await describeProfile({ backend, profile: stored.profile })}; --profile ${requested} ignored\n`;
}

/**
 * `Work (9d2c7e10-…)`: the profile's name and id, as the banner prints them. The name is free text
 * from the backend, so it is shown as plain text: no escape sequence in it reaches the terminal.
 */
export async function describeProfile(params: {
  backend: Backend;
  profile: ProfileId;
}): Promise<string> {
  const found = await profileOf(params);

  return `${plainTerminalText(found?.name ?? 'unknown')} (${params.profile})`;
}

/** The profile, or undefined when the backend says it does not exist; other refusals throw. */
async function profileOf(params: { backend: Backend; profile: ProfileId }) {
  try {
    return await createClient(params.backend).call('getProfile', { profile: params.profile });
  } catch (caughtError) {
    if (caughtError instanceof RefusedError && caughtError.status === 404) return undefined;

    throw caughtError;
  }
}
