import { QUALIFIED_NAME_PATTERN } from '@sheavly/protocol/extension/extension.constants';
import { z } from 'zod';
import { MAX_NAME_LENGTH } from '../manifest/manifest.constants.js';
import {
  MAX_SETTING_VALUE_CHARS,
  MAX_SETTINGS_FILE_ENTRIES,
  SETTINGS_FILE_KEY,
} from './settings-file.constants.js';

const settingValue = z.union([z.string().max(MAX_SETTING_VALUE_CHARS), z.number(), z.boolean()]);

/**
 * Checks every own key of the raw object before `z.record` sees it: `z.record` skips a
 * `__proto__` key without a word, so a key must be refused here, not by the record's key schema.
 */
const settingNames = z.unknown().superRefine((value, context) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;

  for (const name of Object.keys(value)) {
    if (name.length > MAX_NAME_LENGTH || !QUALIFIED_NAME_PATTERN.test(name)) {
      context.addIssue({
        code: 'custom',
        path: [name],
        message: 'the name must be <extension>.<setting>, lowercase words joined by hyphens',
      });
    }
  }
});

/**
 * A settings file: `{ "settings": { "<extension>.<setting>": value } }`. Strict: no other
 * top-level key, a plain object of at most `MAX_SETTINGS_FILE_ENTRIES` entries, names in the
 * manifest's own grammar (which cannot spell `__proto__`, `constructor` or `prototype`), and
 * values only a string, a number or a boolean.
 */
export const settingsFileSchema = z.strictObject({
  [SETTINGS_FILE_KEY]: settingNames
    .pipe(z.record(z.string(), settingValue))
    .refine((entries) => Object.keys(entries).length <= MAX_SETTINGS_FILE_ENTRIES, {
      message: 'has too many entries',
    }),
});
