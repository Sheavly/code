import type { ProjectSettingsCause } from '../project-settings/project-settings.types.js';

/**
 * A project's `.sheavly/settings.json` can't be used. `code` is the fixed cause that
 * `readProjectSettings` reports; the message says why and never holds what the file contains.
 * The reader turns it into a reported problem and does not throw it.
 */
export class ProjectSettingsError extends Error {
  override name = 'ProjectSettingsError';
  readonly code: ProjectSettingsCause;

  constructor(code: ProjectSettingsCause, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
