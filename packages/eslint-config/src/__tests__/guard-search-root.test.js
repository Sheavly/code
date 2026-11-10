import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

const root = 'const searched = await resolveSearchRoot({ workspace, requested });';
const run = 'const out = await runRipgrep({ processes, args: [searched] });';

ruleTester.run('guard-search-root', harnessPlugin.rules['guard-search-root'], {
  valid: [
    // The shape grep and glob follow: check the root, then run ripgrep on it.
    `async function execute() { ${root} ${run} }`,
    `const execute = async () => { ${root} ${run} };`,
    // Code that never runs ripgrep has nothing to check.
    'async function execute() { return list(); }',
    // Each run has a check before it in its own function.
    `async function a() { ${root} ${run} } async function b() { ${root} ${run} }`,
  ],
  invalid: [
    // No check at all.
    `async function execute() { ${run} }`,
    // The check comes after the run.
    `async function execute() { ${run} ${root} }`,
    // A check in another function checks nothing here.
    `async function other() { ${root} } async function execute() { ${run} }`,
    // The check is named but never called.
    `async function execute() { const check = resolveSearchRoot; ${run} }`,
    // A check in a branch may not run.
    `async function execute() { if (strict) { ${root} } ${run} }`,
    `async function execute() { strict && await resolveSearchRoot({ workspace, requested }); ${run} }`,
    // A member call is still a runRipgrep.
    'async function execute() { await helpers.runRipgrep({ processes }); }',
    // The second run has no check of its own.
    `async function a() { ${root} ${run} } async function b() { ${run} }`,
  ].map((code) => ({ code, errors: [{ messageId: 'unguarded' }] })),
});

const ruleOn = (file) => ruleIsErrorOn({ rule: 'harness/guard-search-root', file });

// Enabled for every source file of the coding package, so splitting a tool in two cannot take the
// ripgrep run out of the rule's reach; never for a test.
describe('guard-search-root is enabled', () => {
  it.each(['src/grep/grep.tool.ts', 'src/glob/glob.tool.ts', 'src/ripgrep/ripgrep.helper.ts'])(
    'for %s',
    async (file) => {
      expect(await ruleOn(file)).toBe(true);
    },
  );

  it('not for a test', async () => {
    expect(await ruleOn('src/glob/__tests__/glob.tool.test.ts')).toBe(false);
  });
});
