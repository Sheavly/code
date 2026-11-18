import { z } from 'zod';
import {
  EXTENSION_NAME_PATTERN,
  MAX_EXTENSION_DATA_BYTES,
  MAX_EXTENSION_NAME_CHARS,
  MAX_EXTENSION_QUALIFIED_NAME_CHARS,
  MAX_EXTENSION_TEXT_CHARS,
  QUALIFIED_NAME_PATTERN,
} from './extension.constants.js';
import { jsonBytes } from './extension.utils.js';

/** Any JSON value: what an extension's `data` may hold. Named so the contract references it. */
export const jsonValueSchema = z.json();

/** The kebab name of the extension that sent an event or notice. */
const extensionNameSchema = z
  .string()
  .max(MAX_EXTENSION_NAME_CHARS)
  .regex(EXTENSION_NAME_PATTERN, 'must be lowercase words joined by hyphens');

/** `<extension>.<name>`; the object that holds it checks the extension part matches. */
export const extensionQualifiedNameSchema = z
  .string()
  .max(MAX_EXTENSION_QUALIFIED_NAME_CHARS)
  .regex(QUALIFIED_NAME_PATTERN, 'must be <extension>.<name>, lowercase words joined by hyphens');

/**
 * The fields an extension event and an extension notice share: who sent it, the version of its
 * `data` shape, the `data` itself (any JSON value, which the sender's own schema checked, and
 * which a consumer that does not know the kind skips) and the plain-text `text` fallback.
 */
export const extensionEnvelopeShape = {
  extension: extensionNameSchema,
  version: z.number().int().positive(),
  data: jsonValueSchema.refine((data) => jsonBytes(data) <= MAX_EXTENSION_DATA_BYTES, {
    message: `data must serialize to at most ${MAX_EXTENSION_DATA_BYTES} bytes`,
  }),
  text: z.string().min(1).max(MAX_EXTENSION_TEXT_CHARS),
};
