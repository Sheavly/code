import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

ruleTester.run('guard-env-write', harnessPlugin.rules['guard-env-write'], {
  valid: [
    // The shape every file tool follows: the guarded helper, never the Workspace method.
    'async function run() { return resolveWritable({ workspace, requested }); }',
    'async function run() { return resolveDeletable({ workspace, requested }); }',
    // A read is not this rule's business.
    'async function run() { return workspace.resolveRead(requested); }',
    // Naming a resolver is not calling it.
    'function run() { const resolveWrite = () => undefined; return resolveWrite; }',
  ],
  invalid: [
    'async function run() { return workspace.resolveWrite(requested); }',
    'async function run() { const real = await workspace.resolveDelete(requested); return real; }',
    "async function run() { return workspace['resolveWrite'](requested); }",
    'async function run() { return folder.resolveDelete(requested); }',
  ].map((code) => ({ code, errors: [{ messageId: 'unguarded' }] })),
});

const ruleOn = (file) => ruleIsErrorOn({ rule: 'harness/guard-env-write', file });

// The rule only protects what it is enabled for: every source file of the coding package that
// could resolve a path for a change, never the helper that owns the guarded resolvers, never a test.
describe('guard-env-write is enabled', () => {
  it.each([
    'src/delete-file/delete-file.tool.ts',
    'src/write-file/write-file.tool.ts',
    'src/edit-file/edit-file.tool.ts',
  ])('for %s', async (file) => {
    expect(await ruleOn(file)).toBe(true);
  });

  it('not for the helper that resolves the guarded path', async () => {
    expect(await ruleOn('src/files/files.helper.ts')).toBe(false);
  });

  it('not for a test', async () => {
    expect(await ruleOn('src/delete-file/__tests__/delete-file.tool.test.ts')).toBe(false);
  });
});
