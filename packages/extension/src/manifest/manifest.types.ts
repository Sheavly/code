import type { z } from 'zod';
import type { extensionManifestSchema } from './manifest.validator.js';

/**
 * A parsed `sheavly.json`, every optional field filled with its default. Types derive from the
 * schema, so what the file may hold and what code reads cannot drift.
 */
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

/** One setting declared in a manifest: its `default` has the type `type` names. */
export type SettingManifest = ExtensionManifest['settings'][number];

/** The type names a setting can declare. */
export type SettingType = SettingManifest['type'];
