import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST_SCHEMA_FILE } from '../manifest.constants.js';
import { manifestJsonSchema, printable } from '../manifest.utils.js';

const PACKAGE_ROOT = join(import.meta.dirname, '../../..');

describe('printable', () => {
  it('turns control characters into spaces and keeps a line break only when asked', () => {
    expect(printable({ text: 'a\u001b[31m\nb', max: 50 })).toBe('a [31m b');
    expect(printable({ text: 'a\u001b\nb', max: 50, keepNewlines: true })).toBe('a \nb');
  });

  it('turns format characters such as bidi controls into spaces', () => {
    expect(printable({ text: 'a\u202Eb\u200Bc', max: 50 })).toBe('a b c');
    expect(printable({ text: 'a\u2066b\nc', max: 50, keepNewlines: true })).toBe('a b\nc');
  });

  it('cuts on code-point boundaries, never inside a surrogate pair', () => {
    const cut = printable({ text: '😀😀😀', max: 2 });

    expect(cut).toBe('😀😀… (cut)');
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
});

describe('manifestJsonSchema', () => {
  it('matches the committed sheavly.schema.json (rerun `npm run schema -w @sheavly/extension`)', async () => {
    const committed: unknown = JSON.parse(
      await readFile(join(PACKAGE_ROOT, MANIFEST_SCHEMA_FILE), 'utf8'),
    );

    expect(committed).toEqual(manifestJsonSchema());
  });

  it('rejects unknown keys and accepts $schema, so an editor flags a typo but not the pointer', () => {
    const schema = manifestJsonSchema();

    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['name'],
      properties: { $schema: { type: 'string' } },
    });
  });
});
