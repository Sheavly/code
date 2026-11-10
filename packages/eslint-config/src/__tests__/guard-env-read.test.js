import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

const guard = (name) => `assertNotEnvFile({ filePath: ${name}, requested, action: 'Reading' });`;
const resolve = 'const real = await workspace.resolveRead(requested);';
const SOUND = `async function run() { ${guard('requested')} ${resolve} ${guard('real')} }`;

ruleTester.run('guard-env-read', harnessPlugin.rules['guard-env-read'], {
  valid: [
    // The shape read_file and grep follow: refuse by name, resolve, refuse the real path.
    SOUND,
    // An arrow function, as a tool's `execute` is.
    `const run = async () => { ${guard('requested')} ${resolve} ${guard('real')} };`,
    // Without `await`, and through a computed callee.
    `function run() { ${guard('requested')} const real = workspace['resolveRead'](requested); ${guard('real')} }`,
    // A tool that never resolves a path for reading has nothing to guard here.
    'async function run() { return workspace.resolveWrite(requested); }',
    'function run() { return list(); }',
    // Each resolve is guarded on both sides, with its own variable.
    `async function run() { ${guard('a')} const x = await workspace.resolveRead(a); ${guard('x')} ${guard('b')} const y = await folder.resolveRead(b); ${guard('y')} }`,
  ],
  invalid: [
    // No guard at all, and a result nobody can guard because it is returned.
    'async function run() { return workspace.resolveRead(requested); }',
    // Only the requested path is checked: a symlink to .env gets through.
    `async function run() { ${guard('requested')} return workspace.resolveRead(requested); }`,
    // Only the real path is checked, and the check comes after the read.
    `async function run() { ${resolve} ${guard('real')} }`,
    // The guard is named but never called.
    'async function run() { const guard = assertNotEnvFile; return workspace.resolveRead(requested); }',
    // A different guard is not the .env guard.
    'async function run() { assertNotGitDir({ relativePath: requested }); await workspace.resolveRead(requested); assertNotGitDir({ relativePath: requested }); }',
    // The second resolve has no guard of its own after it.
    `async function run() { ${guard('a')} const x = await workspace.resolveRead(a); ${guard('x')} ${guard('b')} await workspace.resolveRead(b); }`,
    // A guard on the wrong value does not count, either side.
    `async function run() { ${guard('unrelated')} ${resolve} ${guard('real')} }`,
    `async function run() { ${guard('requested')} ${resolve} ${guard('unrelated')} }`,
    // A guard in another function guards nothing here.
    `function other() { ${guard('requested')} ${guard('real')} } async function run() { ${resolve} }`,
    // A guard in a branch may not run.
    `async function run() { if (strict) { ${guard('requested')} } ${resolve} ${guard('real')} }`,
    `async function run() { ${guard('requested')} ${resolve} if (strict) { ${guard('real')} } }`,
    // `G r(a) r(b) G`: the first resolve has no guard on its own real path.
    `async function run() { ${guard('a')} const x = await workspace.resolveRead(a); ${guard('b')} const y = await workspace.resolveRead(b); ${guard('y')} }`,
    // A computed callee is still a resolveRead.
    "async function run() { return workspace['resolveRead'](requested); }",
  ].map((code) => ({ code, errors: [{ messageId: 'unguarded' }] })),
});

const CODING = path.resolve(import.meta.dirname, '../../../coding');

async function ruleOn(file) {
  const config = await new ESLint({ cwd: CODING }).calculateConfigForFile(path.join(CODING, file));
  const entry = config?.rules['harness/guard-env-read'];
  const severity = Array.isArray(entry) ? entry[0] : entry;

  return severity === 2 || severity === 'error';
}

// The rule only protects what it is enabled for: every source file of the coding package that
// could read a path (a tool, or the helper a tool moves the read into), never a test.
describe('guard-env-read is enabled', () => {
  it.each(['src/grep/grep.tool.ts', 'src/ripgrep/ripgrep.helper.ts', 'src/files/files.utils.ts'])(
    'for %s',
    async (file) => {
      expect(await ruleOn(file)).toBe(true);
    },
  );

  it('not for a test', async () => {
    expect(await ruleOn('src/grep/__tests__/grep.tool.test.ts')).toBe(false);
  });
});
