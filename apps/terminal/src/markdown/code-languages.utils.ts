import { LANGUAGES } from './markdown.constants.js';
import type { CodeLanguage } from './markdown.types.js';

// Built once: the keyword sets are read for every highlighted block, and the specs never change.
const READY_LANGUAGES: Record<string, CodeLanguage> = Object.fromEntries(
  Object.entries(LANGUAGES).map(([tag, spec]) => [
    tag,
    { ...spec, keywords: new Set(spec.keywords.split(' ')) },
  ]),
);

/** The language a fence's tag names, or `undefined` when it is untagged or not one we colour. */
export function languageFor(tag: string | undefined): CodeLanguage | undefined {
  if (tag === undefined) return undefined;

  const key = tag.toLowerCase();

  return Object.hasOwn(READY_LANGUAGES, key) ? READY_LANGUAGES[key] : undefined;
}
