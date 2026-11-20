import { describe, expect, it } from 'vitest';
import {
  MAX_SETTING_VALUE_CHARS,
  MAX_SETTINGS_FILE_CHARS,
  MAX_SETTINGS_FILE_ENTRIES,
} from '../settings-file.constants.js';
import { parseSettingsFile } from '../settings-file.helper.js';

const SOURCE = '/home/user/.sheavly/settings.json';
const SECRET = 'sk-live-0123456789abcdef';

/** The problem of a file that must be refused. */
function problemOf(text: string): string {
  const result = parseSettingsFile({ text, source: SOURCE });

  if (result.ok) throw new Error('the file was accepted');

  return result.problem;
}

describe('parseSettingsFile', () => {
  it('returns the raw values of a valid file, frozen', () => {
    const result = parseSettingsFile({
      text: JSON.stringify({
        settings: { 'notes.max': 3, 'notes.title': 'Hi', 'notes.loud': false },
      }),
      source: SOURCE,
    });

    expect(result).toEqual({
      ok: true,
      values: { 'notes.max': 3, 'notes.title': 'Hi', 'notes.loud': false },
    });
    expect(result.ok && Object.isFrozen(result.values)).toBe(true);
  });

  it('accepts an empty settings object', () => {
    expect(parseSettingsFile({ text: '{"settings":{}}', source: SOURCE })).toEqual({
      ok: true,
      values: {},
    });
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a top-level array', '[]'],
    ['a top-level null', 'null'],
    ['a missing settings key', '{}'],
    ['an unknown top-level key', '{"settings":{},"apiKey":"x"}'],
    ['a settings array', '{"settings":[]}'],
    ['a settings string', '{"settings":"x"}'],
    ['a null value', '{"settings":{"notes.a":null}}'],
    ['an array value', '{"settings":{"notes.a":[1]}}'],
    ['an object value', '{"settings":{"notes.a":{"b":1}}}'],
    ['a name without an extension', '{"settings":{"max":1}}'],
    ['an uppercase name', '{"settings":{"notes.Max":1}}'],
    ['a name with a third part', '{"settings":{"notes.a.b":1}}'],
    ['a __proto__ key', '{"settings":{"__proto__":1}}'],
    ['a constructor key', '{"settings":{"constructor":1}}'],
    ['a prototype key', '{"settings":{"prototype":1}}'],
    ['a dotted __proto__ key', '{"settings":{"notes.__proto__":1}}'],
  ])('refuses %s, naming the source', (_what, text) => {
    expect(problemOf(text).startsWith(`${SOURCE}: `)).toBe(true);
  });

  it('leaves Object.prototype clean after a __proto__ entry', () => {
    parseSettingsFile({ text: '{"settings":{"__proto__":{"polluted":true}}}', source: SOURCE });

    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    expect('polluted' in {}).toBe(false);
  });

  it('refuses a string value over the cap and accepts one at it', () => {
    const value = (size: number) => JSON.stringify({ settings: { 'notes.a': 'x'.repeat(size) } });

    expect(parseSettingsFile({ text: value(MAX_SETTING_VALUE_CHARS), source: SOURCE }).ok).toBe(
      true,
    );
    expect(problemOf(value(MAX_SETTING_VALUE_CHARS + 1))).toMatch(/at most/);
  });

  it('refuses more than the entry cap and accepts exactly the cap', () => {
    const entries = (size: number) =>
      JSON.stringify({
        settings: Object.fromEntries(
          Array.from({ length: size }, (_, index) => [`n.a${index}`, 1]),
        ),
      });

    expect(parseSettingsFile({ text: entries(MAX_SETTINGS_FILE_ENTRIES), source: SOURCE }).ok).toBe(
      true,
    );
    expect(problemOf(entries(MAX_SETTINGS_FILE_ENTRIES + 1))).toMatch(/too many entries/);
  });

  it('refuses a file over the size cap without parsing it', () => {
    expect(problemOf(' '.repeat(MAX_SETTINGS_FILE_CHARS + 1))).toMatch(/larger than/);
  });

  it.each([
    ['text over the cap', ' '.repeat(MAX_SETTINGS_FILE_CHARS + 1), 'too-large'],
    ['malformed JSON', `{"settings": "${SECRET}`, 'not-json'],
    ['a byte order mark', `\uFEFF{"settings":{}}`, 'not-json'],
    ['valid JSON of the wrong shape', `{"settings":["${SECRET}"]}`, 'bad-shape'],
    ['a stray top-level key', `{"apiKey":"${SECRET}"}`, 'bad-shape'],
  ])('tells the cause as a fixed code: %s', (_what, text, cause) => {
    const result = parseSettingsFile({ text, source: SOURCE });

    expect(result).toMatchObject({ ok: false, cause });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('says an unknown top-level key is not allowed, without echoing it or its value', () => {
    const problem = problemOf(`{"settings":{},"apiKey":"${SECRET}"}`);

    expect(problem).toContain('only "settings" is allowed at the top level');
  });

  it.each([
    ['a value of the wrong kind', `{"settings":{"notes.a":["${SECRET}"]}}`],
    ['a secret in an unknown top-level key', `{"settings":{},"token":"${SECRET}"}`],
    ['a secret as an entry name', `{"settings":{"${SECRET}":1}}`],
    ['a secret in an object value', `{"settings":{"notes.a":{"k":"${SECRET}"}}}`],
    ['a secret in malformed JSON', `{"settings":{"notes.a":"${SECRET}"`],
    ['a secret in a too-long value', `{"settings":{"notes.a":"${SECRET.repeat(100)}"}}`],
    ['a secret under __proto__', `{"settings":{"__proto__":"${SECRET}"}}`],
  ])('never quotes the file’s text in the problem: %s', (_what, text) => {
    const problem = problemOf(text);

    expect(problem).not.toContain(SECRET);
    expect(problem).not.toContain('sk-live');
  });
});
