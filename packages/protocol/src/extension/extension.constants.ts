/**
 * An extension's name: lowercase words joined by hyphens, so it is safe in messages, paths and
 * the attribute of a model-facing notice. The extension package's manifest validator imports it.
 */
export const EXTENSION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A name an extension owns inside its own namespace: `<extension>.<name>`, each part lowercase
 * words joined by hyphens. An extension event's `kind` and an extension notice's `topic`.
 */
export const QUALIFIED_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Maximum length of one part of an extension name, as the manifest caps a name. */
export const MAX_EXTENSION_NAME_CHARS = 128;

/** Maximum length of an extension event's `kind` or an extension notice's `topic`. */
export const MAX_EXTENSION_QUALIFIED_NAME_CHARS = 2 * MAX_EXTENSION_NAME_CHARS + 1;

/**
 * Maximum characters of the `text` of an extension event or notice: the plain-text fallback a
 * terminal shows and, for a notice, the only part the model reads.
 */
export const MAX_EXTENSION_TEXT_CHARS = 2000;

/** Maximum bytes of the `data` of an extension event or notice once serialized as JSON. */
export const MAX_EXTENSION_DATA_BYTES = 16_384;
