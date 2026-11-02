import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
);

it('is @sheavly/host, created as a generic workspace', () => {
  expect(manifest).toMatchObject({ name: '@sheavly/host', sheavly: { domain: 'generic' } });
});
