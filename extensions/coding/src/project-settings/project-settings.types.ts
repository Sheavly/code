/**
 * Why a settings file that is there can't be used, as a fixed code and never text from the file:
 * `too-large` (over the cap), `not-a-file` (a folder, a FIFO, a device), `link` (the file or
 * `.sheavly/` is a link, leads outside `.sheavly/`, or is a `.env` file), `not-utf8`, or
 * `unreadable` (anything else, such as permissions).
 */
export type ProjectSettingsCause = 'too-large' | 'not-a-file' | 'link' | 'not-utf8' | 'unreadable';

/**
 * What reading a project's `.sheavly/settings.json` found. `ok: false` is a file that is there
 * and cannot be used: `reason` is a fixed code and never holds what the file contains.
 */
export type ProjectSettingsRead =
  | { ok: true; text: string; path: string }
  | { ok: false; path: string; reason: ProjectSettingsCause };
