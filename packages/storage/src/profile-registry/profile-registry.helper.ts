import type { Profile, ProfileId } from '@sheavly/protocol/profile/profile.types';
import { RegistryError } from '../errors/registry.errors.js';
import type { ProfileStore } from '../profile-store/profile-store.service.js';

/**
 * The profile with this id. Throws a `RegistryError` (`unknown_profile`) when there is none: it was
 * never made, or it was deleted. A profile whose `profile.json` is damaged throws what the store
 * throws, since that is not the same as absent.
 */
export async function requireProfile(params: {
  profiles: ProfileStore;
  id: ProfileId;
}): Promise<Profile> {
  const { profiles, id } = params;
  const profile = await profiles.get(id);

  if (!profile) {
    throw new RegistryError({
      reason: 'unknown_profile',
      message: `There is no profile ${id}: it was never made, or it was deleted`,
    });
  }

  return profile;
}
