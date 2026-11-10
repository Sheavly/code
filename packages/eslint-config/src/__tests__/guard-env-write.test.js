import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

const invalid = (code, messageId) => ({ code, errors: [{ messageId }] });

ruleTester.run('guard-env-write', harnessPlugin.rules['guard-env-write'], {
  valid: [
    // The shapes the file tools follow: a guarded resolver, then its effects with that path.
    'async function run() { return resolveWritable({ workspace, requested }); }',
    'async function run() { const real = await resolveWritable({ workspace, requested }); await writeText({ file: real, content, signal }); }',
    'async function run() { const real = await resolveWritable({ workspace, requested }); await createParentFolder({ file: real }); }',
    'async function run() { const real = await resolveDeletable({ workspace, requested }); await removeFile({ file: real, signal }); }',
    'const run = async () => { const real = await resolveDeletable({ workspace, requested }); await removeFile({ file: real, signal }); };',
    // Resolved outside the lock for its key, changed inside the callback, as the tools do.
    'async function run() { const real = await resolveDeletable({ workspace, requested }); return fileLocks.run({ change: async () => { await removeFile({ file: real, signal }); } }); }',
    // A read is not this rule's business.
    'async function run() { return workspace.resolveRead(requested); }',
    // Naming a resolver is not calling it.
    'function run() { const resolveWrite = () => undefined; return resolveWrite; }',
  ],
  invalid: [
    invalid('async function run() { return workspace.resolveWrite(requested); }', 'unguarded'),
    invalid(
      'async function run() { const real = await workspace.resolveDelete(requested); return real; }',
      'unguarded',
    ),
    invalid("async function run() { return workspace['resolveWrite'](requested); }", 'unguarded'),
    invalid('async function run() { return folder.resolveDelete(requested); }', 'unguarded'),
    // A write of a path that never went through `resolveWritable`.
    invalid(
      'async function run() { await writeText({ file: requested, content, signal }); }',
      'unguardedWrite',
    ),
    invalid(
      "async function run() { await createParentFolder({ file: 'src' }); }",
      'unguardedWrite',
    ),
    // Each effect takes the path of its own resolver.
    invalid(
      'async function run() { const real = await resolveDeletable({ workspace, requested }); await writeText({ file: real, content, signal }); }',
      'unguardedWrite',
    ),
    // `resolveWritable` follows a symlink, so a delete through it removes the target.
    invalid(
      'async function run() { const real = await resolveWritable({ workspace, requested }); await removeFile({ file: real, signal }); }',
      'unguardedDelete',
    ),
    // The path assigned by the resolver is not the one changed.
    invalid(
      'async function run() { const real = await resolveDeletable({ workspace, requested }); await removeFile({ file: other, signal }); }',
      'unguardedDelete',
    ),
    // A resolver in another function does not cover this one.
    invalid(
      'async function other() { return resolveDeletable({ workspace, requested }); } async function run() { await removeFile({ file: real, signal }); }',
      'unguardedDelete',
    ),
    invalid(
      'async function other() { return resolveWritable({ workspace, requested }); } async function run() { await writeText({ file: real, content, signal }); }',
      'unguardedWrite',
    ),
  ],
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
