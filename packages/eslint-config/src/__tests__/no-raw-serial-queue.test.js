import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

ruleTester.run('no-raw-serial-queue', harnessPlugin.rules['no-raw-serial-queue'], {
  valid: [
    "import { LockedChange } from '../serial-queue/locked-change.service.js'; new LockedChange({ name: 'x' });",
    'const queue = makeQueue();',
    'new OtherQueue();',
    "import { SerialQueue } from './serial-queue.service.js'; type Q = SerialQueue;",
  ],
  invalid: [
    { code: 'const queue = new SerialQueue();', errors: [{ messageId: 'm0' }] },
    { code: 'const queue = new queues.SerialQueue();', errors: [{ messageId: 'm0' }] },
    {
      code: "import { SerialQueue as Q } from './serial-queue.service.js';",
      errors: [{ messageId: 'm0' }],
    },
    {
      code: 'class Store { readonly #writes = new SerialQueue(); }',
      errors: [{ messageId: 'm0' }],
    },
  ],
});

const STORAGE = 'packages/storage';
const on = (file) => ruleIsErrorOn({ rule: 'harness/no-raw-serial-queue', folder: STORAGE, file });

// The exceptions are pinned: a renamed file or a widened override changes these answers.
describe('no-raw-serial-queue in storage', () => {
  it('is on for every store, so each changes its file through LockedChange', async () => {
    for (const file of [
      'src/config-store/config-store.service.ts',
      'src/credential-store/credential-store.service.ts',
      'src/permission-store/permission-store.service.ts',
      'src/document-file/document-file.service.ts',
      'src/conversation-store/conversation-store.service.ts',
    ]) {
      expect(await on(file), file).toBe(true);
    }
  });

  it('is off only for the primitive, the append-only logs and the profile queue', async () => {
    for (const file of [
      'src/serial-queue/locked-change.service.ts',
      'src/conversation-store/append-log.service.ts',
      'src/profile-registry/profile-registry.service.ts',
    ]) {
      expect(await on(file), file).toBe(false);
    }
  });

  it('is on in another workspace', async () => {
    expect(
      await ruleIsErrorOn({ rule: 'harness/no-raw-serial-queue', file: 'src/files/x.helper.ts' }),
    ).toBe(true);
  });
});
