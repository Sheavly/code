import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
);

it('is @sheavly/workbook, created as a coding workspace', () => {
  expect(manifest).toMatchObject({ name: '@sheavly/workbook', sheavly: { domain: 'coding' } });
});
