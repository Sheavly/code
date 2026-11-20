/**
 * The user's own global or profile `settings.json` can't be used (it is not valid JSON, has the
 * wrong shape, or holds more than a settings file may), so the run does not start. The message
 * names the file and the reason, never what the file contains.
 */
export class SettingsFileError extends Error {
  override name = 'SettingsFileError';
}
