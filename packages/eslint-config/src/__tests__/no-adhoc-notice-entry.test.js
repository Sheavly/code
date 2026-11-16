import { describe, expect, it } from 'vitest';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { harnessPlugin } from '../plugin.js';

const RULE = 'no-adhoc-notice-entry';
const tester = typescriptRuleTester({ ecmaVersion: 'latest', sourceType: 'module' });

tester.run(RULE, harnessPlugin.rules[RULE], {
  valid: [
    'publishNotice({ events, messages, notice, at });',
    "messages.push({ role: 'user', content: 'hi' });",
    "const schema = z.object({ role: z.literal('notice') });",
    'const entry = { role, notice };',
    "if (message.role === 'notice') show(message.notice);",
    "messages.push({ role: 'user' as const, content: 'hi' });",
  ],
  invalid: [
    {
      code: "messages.push({ role: 'notice', notice, at: now() });",
      errors: [{ messageId: 'm0' }],
    },
    { code: "const entry = { notice, role: 'notice' };", errors: [{ messageId: 'm0' }] },
    { code: "return [{ role: 'notice', notice }];", errors: [{ messageId: 'm0' }] },
    {
      code: "messages.push({ role: 'notice' as const, notice, at });",
      errors: [{ messageId: 'm0' }],
    },
    {
      code: "messages.push({ role: 'notice' satisfies HistoryMessage['role'], notice });",
      errors: [{ messageId: 'm0' }],
    },
    { code: "const entry = { 'role': 'notice', notice };", errors: [{ messageId: 'm0' }] },
  ],
});

const LOOP = 'packages/loop';
const on = (file) => ruleIsErrorOn({ rule: `harness/${RULE}`, folder: LOOP, file });

// The one exception is pinned: a renamed helper or a widened override changes these answers.
describe('no-adhoc-notice-entry in the loop', () => {
  it('is on for the code that delivers or restores notices', async () => {
    for (const file of [
      'src/stream-agent/task-delivery.helper.ts',
      'src/hooks/hook-failures.helper.ts',
      'src/stream-agent/sample.helper.ts',
      'src/stream-agent/restored-reports.helper.ts',
    ]) {
      expect(await on(file), file).toBe(true);
    }
  });

  it('is off only in the helper that turns a kind’s lifetime into an entry', async () => {
    expect(await on('src/stream-agent/notice-publish.helper.ts')).toBe(false);
  });

  it('is off in tests, which write entries to set a history up', async () => {
    expect(await on('src/stream-agent/__tests__/x.test.ts')).toBe(false);
  });
});
