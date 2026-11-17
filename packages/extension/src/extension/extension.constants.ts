/** An extension's name: lowercase words joined by hyphens, so it is safe in messages and paths. */
export const EXTENSION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A setting's name: `<extension>.<setting>`, each part lowercase words joined by hyphens. */
export const SETTING_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The provider name of the services the host supplies. Not a valid extension name (those are
 * kebab-case), so it can never clash with an extension.
 */
export const HOST_PROVIDER = '<host>';
