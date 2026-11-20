/** The settings file inside a project's `.sheavly/` folder. */
export const PROJECT_SETTINGS_FILE = 'settings.json';

/**
 * The largest settings file read, in bytes. A repository's file is untrusted input, so it is
 * measured before it is read; the same figure bounds the user's own files (the extension
 * package's settings file contract states it in characters).
 */
export const MAX_PROJECT_SETTINGS_BYTES = 64 * 1024;
