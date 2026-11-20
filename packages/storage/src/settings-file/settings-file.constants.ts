/** A settings file's name: at the root of the user's folder, and inside each profile's folder. */
export const SETTINGS_FILE = 'settings.json';

/**
 * The largest settings file read, in bytes. Storage sits below `@sheavly/extension` and cannot
 * import its settings file contract, which states the same 64 KiB (in characters); keep the two in
 * step. A byte cap is the stricter of the two, so a file under it is never over the contract's.
 */
export const MAX_SETTINGS_FILE_BYTES = 64 * 1024;
