import { QUALIFIED_NAME_PATTERN } from '@sheavly/protocol/extension/extension.constants';
import type { z } from 'zod';
import {
  MAX_REPORTED_PROBLEMS,
  MAX_SETTING_VALUE_CHARS,
  MAX_SETTINGS_FILE_CHARS,
  SETTINGS_FILE_KEY,
} from './settings-file.constants.js';
import type { SettingsFileResult } from './settings-file.types.js';
import { settingsFileSchema } from './settings-file.validator.js';

type Issue = z.ZodError['issues'][number];

/** One path segment as a message shows it: a name only when it is a valid one, never raw file text. */
function segmentOf(segment: PropertyKey): string {
  if (typeof segment === 'number') return `[${segment}]`;

  const text = String(segment);

  return text === SETTINGS_FILE_KEY || QUALIFIED_NAME_PATTERN.test(text) ? text : '(an entry)';
}

/** What is wrong, from the kind of issue alone: nothing in it comes from a value of the file. */
function reasonOf(issue: Issue): string {
  switch (issue.code) {
    case 'unrecognized_keys':
      return `only "${SETTINGS_FILE_KEY}" is allowed at the top level`;
    case 'invalid_union':
      return 'the value must be a string, a number or a boolean';
    case 'invalid_type':
      return `expected ${issue.expected}`;
    case 'too_big':
      return `a string value is at most ${MAX_SETTING_VALUE_CHARS} characters`;
    case 'custom':
      return issue.message;
    default:
      return 'is invalid';
  }
}

/** The issues as `<where>: <reason>` lines, the first few only. */
function describeIssues(issues: readonly Issue[]): string {
  return issues
    .slice(0, MAX_REPORTED_PROBLEMS)
    .map((issue) => {
      const where = issue.path.length === 0 ? 'the file' : issue.path.map(segmentOf).join('.');

      return `${where}: ${reasonOf(issue)}`;
    })
    .join('; ');
}

/**
 * Parses the text of a settings file, `{ "settings": { "<extension>.<setting>": value } }`,
 * strictly: no other top-level key, at most `MAX_SETTINGS_FILE_ENTRIES` entries, only string,
 * number and boolean values, names in the manifest's grammar. `source` labels the file (a path or a name) in the problem.
 * Returns the raw values, not yet checked against what the extensions declare (`layerSettings`
 * does that), or a problem that names the source and the reason and never quotes the text, so a
 * secret that was written in the wrong place cannot leak through a message.
 */
export function parseSettingsFile(params: { text: string; source: string }): SettingsFileResult {
  const { text, source } = params;

  if (text.length > MAX_SETTINGS_FILE_CHARS) {
    return {
      ok: false,
      problem: `${source}: the file is larger than ${MAX_SETTINGS_FILE_CHARS} characters`,
      cause: 'too-large',
    };
  }

  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (caughtError) {
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    // A `JSON.parse` message quotes a snippet of the text, which may hold a value.
    return { ok: false, problem: `${source}: the file is not valid JSON`, cause: 'not-json' };
  }

  const parsed = settingsFileSchema.safeParse(json);

  if (!parsed.success) {
    return {
      ok: false,
      problem: `${source}: ${describeIssues(parsed.error.issues)}`,
      cause: 'bad-shape',
    };
  }

  return { ok: true, values: Object.freeze({ ...parsed.data[SETTINGS_FILE_KEY] }) };
}
