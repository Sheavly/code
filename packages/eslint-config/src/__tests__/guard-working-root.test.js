import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

const anchor = 'const anchored = anchorToRoot({ requested, root });';

ruleTester.run('guard-working-root', harnessPlugin.rules['guard-working-root'], {
  valid: [
    // The shape read_file follows: anchor, then resolve the anchored path.
    `async function run() { ${anchor} return workspace.resolveRead(anchored); }`,
    // Anchoring inside the call, as `resolveWritable` does.
    'const run = (asking) => workspace.resolveWrite(anchorToRoot({ requested: asking, root }));',
    // Every resolver is covered, with or without `await`.
    `async function run() { ${anchor} await workspace.resolveDelete(anchored); }`,
    `async function run() { const anchored = await anchorToRoot({ requested, root }); workspace.resolveWrite(anchored); }`,
    // A variable anchored in an enclosing function reaches a callback.
    `async function run() { ${anchor} return items.map((item) => workspace.resolveRead(anchored)); }`,
    // Code that never resolves a path has nothing to anchor.
    'function run() { return list(); }',
  ],
  invalid: [
    // The requested path goes straight in: a relative path would start at the workspace root.
    'async function run() { return workspace.resolveRead(requested); }',
    'async function run() { return workspace.resolveWrite(requested); }',
    'async function run() { return workspace.resolveDelete(requested); }',
    // The anchor comes after the call.
    `async function run() { await workspace.resolveRead(anchored); ${anchor} }`,
    // An anchor in another function anchors nothing here.
    `function other() { ${anchor} } async function run() { return workspace.resolveRead(anchored); }`,
    // A variable that is not an anchor.
    'async function run() { const anchored = requested; return workspace.resolveRead(anchored); }',
    // Another function's result is not the anchor.
    'async function run() { return workspace.resolveRead(join(root, requested)); }',
    // A call with no argument anchors nothing.
    'async function run() { return workspace.resolveRead(); }',
    // A computed callee is still a resolver.
    "async function run() { return workspace['resolveRead'](requested); }",
    // The second resolve has no anchor of its own.
    `async function run() { ${anchor} await workspace.resolveRead(anchored); await workspace.resolveRead(other); }`,
  ].map((code) => ({ code, errors: [{ messageId: 'unanchored' }] })),
});

ruleTester.run('guard-working-root (cwd and root)', harnessPlugin.rules['guard-working-root'], {
  valid: [
    // A process started in the folder the tool resolved from the working root.
    'const run = () => runRipgrep({ processes, args, cwd, signal });',
    'const run = () => runRipgrep({ cwd: root ?? workspace.root, signal });',
    // `root` passed on from what the tool read.
    'const run = () => resolveWritable({ workspace, requested, root });',
    // `undefined` for anything but `root`.
    'const run = () => open({ scratch: undefined });',
  ],
  invalid: [
    // A process that ignores the working root.
    {
      code: 'const run = () => runRipgrep({ processes, cwd: workspace.root, signal });',
      errors: [{ messageId: 'rootCwd' }],
    },
    {
      code: 'const run = () => processes.run({ file, args, cwd: workspace.root });',
      errors: [{ messageId: 'rootCwd' }],
    },
    // A call that tells a helper there is no root.
    {
      code: 'const run = () => resolveWritable({ workspace, requested, root: undefined });',
      errors: [{ messageId: 'rootUndefined' }],
    },
    {
      code: 'const run = () => changeResult({ workspace, file, root: undefined });',
      errors: [{ messageId: 'rootUndefined' }],
    },
  ],
});

const ruleOn = (file) => ruleIsErrorOn({ rule: 'harness/guard-working-root', file });

// Enabled for every source file of the coding package, so a new tool or a helper a tool moves its
// resolve into cannot skip the root; never for a test.
describe('guard-working-root is enabled', () => {
  it.each([
    'src/read-file/read-file.tool.ts',
    'src/ripgrep/ripgrep.helper.ts',
    'src/files/files.helper.ts',
    'src/run-command/command-cwd.helper.ts',
  ])('for %s', async (file) => {
    expect(await ruleOn(file)).toBe(true);
  });

  it('not for a test', async () => {
    expect(await ruleOn('src/read-file/__tests__/read-file.tool.test.ts')).toBe(false);
  });
});
