/**
 * The longest settings file `parseSettingsFile` reads, in characters (64 Ki; a character is at
 * least one byte, so the file is at most as long in bytes as this allows for plain text).
 */
export const MAX_SETTINGS_FILE_CHARS = 64 * 1024;

/** The most entries one settings file may hold, as many as a manifest list may. */
export const MAX_SETTINGS_FILE_ENTRIES = 1000;

/** The longest string value one setting in a settings file may hold, as a manifest's text fields. */
export const MAX_SETTING_VALUE_CHARS = 1000;

/** The only top-level key of a settings file. */
export const SETTINGS_FILE_KEY = 'settings';

/** How many problems a settings file's message lists before it stops. */
export const MAX_REPORTED_PROBLEMS = 5;
