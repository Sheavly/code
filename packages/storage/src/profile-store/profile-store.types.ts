import type { Profile } from '@sheavly/protocol/profile/profile.types';
import type { FileProblem } from '../listing/listing.types.js';

/**
 * What the profiles folder holds: the profiles that read cleanly (by name, then id, so the order
 * is the same on every system), and a problem for each folder that did not.
 */
export type ProfileListing = {
  profiles: Profile[];
  problems: FileProblem[];
};
