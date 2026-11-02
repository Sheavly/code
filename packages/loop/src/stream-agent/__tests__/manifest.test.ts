import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
);

it('is @sheavly/loop, created as a generic workspace', () => {
  expect(manifest).toMatchObject({ name: '@sheavly/loop', sheavly: { domain: 'generic' } });
});
