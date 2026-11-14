import { afterAll, describe, expect, it } from 'vitest';
import { typedProject } from '../testing/typed-project.fake.js';

// `no-brand-cast` is type-aware, so it lints real files of a temp project with a tsconfig. The
// brand is declared the way zod declares it: a `unique symbol` property on an intersection.
const project = typedProject({
  name: 'no-brand-cast',
  rule: 'harness/no-brand-cast',
  include: ['*.ts'],
});
const BRAND = [
  'declare const $brand: unique symbol;',
  'type SessionId = string & { [$brand]: { SessionId: true } };',
  'type Plain = string;',
  'declare function parse(value: unknown): SessionId;',
].join('\n');

const castsIn = (name, code) => project.lint({ file: `${name}.ts`, code: `${BRAND}\n${code}\n` });

afterAll(project.remove);

describe('no-brand-cast', () => {
  it('lets a branded value be parsed, and other types be asserted', async () => {
    expect(
      await castsIn(
        'valid',
        "export const id = parse('s1');\nexport const plain = 'x' as Plain;\nexport const s = id as string;",
      ),
    ).toEqual([]);
  });

  it('refuses asserting a branded type, directly or in a union', async () => {
    expect(
      await castsIn(
        'invalid',
        "export const a = 's1' as SessionId;\nexport const b = (undefined as unknown) as SessionId | undefined;",
      ),
    ).toEqual(['harness/no-brand-cast', 'harness/no-brand-cast']);
  });
});
