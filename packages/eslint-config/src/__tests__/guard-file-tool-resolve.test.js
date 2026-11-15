import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

ruleTester.run('guard-file-tool-resolve', harnessPlugin.rules['guard-file-tool-resolve'], {
  valid: [
    // The supported path: the guard, per intent.
    'const run = () => runFileTool({ requested, signal, run: () => resolveReadable({ workspace, requested, root }) });',
    'const run = () => runFileTool({ requested, signal, run: () => resolveWritable({ workspace, requested, root }) });',
    'const run = () => runFileTool({ requested, signal, run: () => resolveDeletable({ workspace, requested, root }) });',
    'const run = async () => resolveSearchRoot({ workspace, workingRoots, requested });',
    // Importing the guard is fine.
    "import { resolveReadable } from '../files/files.helper.js';",
    // Other workspace members and unrelated names.
    'const run = () => workspace.relative(real);',
    "const run = () => workspace['relative'](real);",
    'const run = () => resolve(requested);',
  ],
  invalid: [
    // A direct call.
    'const run = () => workspace.resolveRead(anchored);',
    'const run = () => workspace.resolveWrite(anchored);',
    'const run = () => workspace.resolveDelete(anchored);',
    // Whatever the receiver is called.
    'const run = () => this.workspace.resolveRead(anchored);',
    'const run = () => ws?.resolveRead(anchored);',
    // Bypasses: a computed literal, an alias, `.call`/`.apply`, destructuring.
    "const run = () => workspace['resolveRead'](anchored);",
    'const resolve = workspace.resolveRead;',
    'const run = () => workspace.resolveWrite.call(workspace, anchored);',
    'const run = () => workspace.resolveDelete.apply(workspace, [anchored]);',
    'const { resolveRead } = workspace;',
    'const { resolveWrite: write } = workspace;',
    // Importing or re-exporting the raw name, aliased or not.
    "import { resolveRead as read } from './somewhere.js';",
    "export { resolveWrite } from './somewhere.js';",
    "export { resolveDelete as remove } from './somewhere.js';",
  ].map((code) => ({ code, errors: [{ messageId: 'raw' }] })),
});

ruleTester.run(
  'guard-file-tool-resolve (runFileTool)',
  harnessPlugin.rules['guard-file-tool-resolve'],
  {
    valid: [
      // The supported shape: the body runs through the wrapper.
      'const run = () => runFileTool({ requested, signal, run: () => resolveReadable({ workspace, requested, root }) });',
      // A file that never asks the guard needs no wrapper.
      'const run = () => resolveSearchRoot({ workspace, requested });',
    ],
    invalid: [
      'const run = async () => resolveWritable({ workspace, requested, root });',
      'const run = async () => resolveDeletable({ workspace, requested, root });',
    ].map((code) => ({ code, errors: [{ messageId: 'unwrapped' }] })),
  },
);

const ruleOn = (file) => ruleIsErrorOn({ rule: 'harness/guard-file-tool-resolve', file });

// Every tool file of the coding package, so a new tool cannot skip the guard; never a helper (the
// guard itself calls the raw resolvers) and never a test.
describe('guard-file-tool-resolve is enabled', () => {
  it.each([
    'src/read-file/read-file.tool.ts',
    'src/write-file/write-file.tool.ts',
    'src/edit-file/edit-file.tool.ts',
    'src/delete-file/delete-file.tool.ts',
    'src/run-command/run-command.tool.ts',
    'src/glob/glob.tool.ts',
  ])('for %s', async (file) => {
    expect(await ruleOn(file)).toBe(true);
  });

  it.each([
    'src/files/files.helper.ts',
    'src/ripgrep/ripgrep.helper.ts',
    'src/read-file/__tests__/read-file.tool.test.ts',
  ])('not for %s', async (file) => {
    expect(await ruleOn(file)).toBe(false);
  });
});
