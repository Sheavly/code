import type { ProfileId } from '@sheavly/protocol/profile/profile.types';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { BackendError } from '../errors/backend.errors.js';

/**
 * The profile a run starts on, from `--profile <id>`, and the arguments without the flag and its
 * value, so neither ends up in the prompt. None when the flag is absent. Throws when the id is
 * missing or is not a profile id (a lowercase UUID): a typo never falls back to another profile.
 */
export function profileArgs(args: readonly string[]): {
  profile: ProfileId | undefined;
  args: readonly string[];
} {
  const index = args.indexOf('--profile');

  if (index === -1) return { profile: undefined, args };

  const parsed = profileIdSchema.safeParse(args[index + 1]);

  if (!parsed.success) {
    throw new BackendError({ message: '--profile requires a profile id (a lowercase UUID)' });
  }

  return {
    profile: parsed.data,
    args: args.filter((_, position) => position !== index && position !== index + 1),
  };
}
