/** The folder under the root that holds every profile, one folder each. */
export const PROFILES_FOLDER = 'profiles';

/** A profile's own file, inside its folder: `{ id, name }`. */
export const PROFILE_FILE = 'profile.json';

/**
 * Deleting a folder is retried while another program holds a file in it (Windows, with a virus
 * scanner or an indexer): Node tries again after a pause that grows with each attempt.
 */
export const RM_RETRIES = 5;
export const RM_RETRY_DELAY_MS = 50;
