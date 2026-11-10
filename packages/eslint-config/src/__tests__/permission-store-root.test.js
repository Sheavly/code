import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });

const root = 'await permissionRoot({ workspace, env })';

ruleTester.run('permission-store-root', harnessPlugin.rules['permission-store-root'], {
  valid: [
    // The shape the backend follows: key every store call by the main worktree's folder.
    `async function f() { await this.#store.read(${root}); }`,
    `async function f() { await store.setMode({ realPath: ${root}, mode }); }`,
    `async function f() { await this.#store.allow({ realPath: ${root}, entry }); }`,
    `async function f() { await permissionStore.revoke({ entry, realPath: ${root} }); }`,
    'function f() { return store.read(permissionRoot({ workspace, env })); }',
    // Methods of other values are none of the rule's business.
    'async function f() { await cache.read(path); await files.allow({ realPath: path }); }',
    'async function f() { await store.list(path); }',
    'async function f() { await permissionStoreFor(env).read(await permissionRoot({ workspace, env })); }',
    // Documented gaps, pinned so a change to them is a decision: `.call` and destructuring.
    'async function f() { await store.read.call(store, workspace); }',
    'async function f() { const { read } = store; await read(workspace); }',
  ],
  invalid: [
    'async function f() { await this.#store.read(workspace); }',
    'async function f() { await store.setMode({ realPath: workspace, mode }); }',
    'async function f() { await this.#store.allow({ realPath: real, entry }); }',
    'async function f() { await permissionStore.revoke({ entry }); }',
    // A path kept in a variable first is not written in the call.
    `async function f() { const key = ${root}; await store.read(key); }`,
    // Another function is not `permissionRoot`.
    'async function f() { await store.read(await resolveRoot({ workspace })); }',
    // A spread hides the key.
    'async function f() { await store.allow({ ...params }); }',
    'async function f() { await store.read(); }',
    // The factory's result, optional chaining and a computed method are still store calls.
    'async function f() { await permissionStoreFor(env).read(workspace); }',
    'async function f() { await store?.read(workspace); }',
    "async function f() { await store['allow']({ realPath: workspace, entry }); }",
  ].map((code) => ({ code, errors: [{ messageId: 'unkeyed' }] })),
});

const ruleOn = (file) =>
  ruleIsErrorOn({ rule: 'harness/permission-store-root', file, folder: 'apps/backend' });

// Enabled for every source file of the backend, so moving a store call to another file cannot take
// it out of the rule's reach; never for a test.
describe('permission-store-root is enabled', () => {
  it.each([
    'src/harness/conversation-permissions.service.ts',
    'src/profiles/permission-setup.service.ts',
    'src/backend.helper.ts',
  ])('for %s', async (file) => {
    expect(await ruleOn(file)).toBe(true);
  });

  it('not for a test', async () => {
    expect(await ruleOn('src/harness/__tests__/permissions.helper.test.ts')).toBe(false);
  });
});
