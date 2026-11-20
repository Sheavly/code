import type { SettingValue } from '../extension/extension.types.js';

/**
 * Why a settings file's text can't be used, as a fixed code: `too-large` (over the character
 * cap), `not-json`, or `bad-shape` (JSON, but not a settings file).
 */
export type SettingsFileCause = 'too-large' | 'not-json' | 'bad-shape';

/**
 * What `parseSettingsFile` makes of a settings file: its raw values by `<extension>.<setting>`
 * name (not yet checked against what the extensions declare), or the one problem that names the
 * file by its source label, with its fixed `cause`. A problem never quotes a value from the file.
 */
export type SettingsFileResult =
  | { ok: true; values: Readonly<Record<string, SettingValue>> }
  | { ok: false; problem: string; cause: SettingsFileCause };
