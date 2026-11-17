import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const RULE_NAME = 'no-adhoc-chat-state';
const tester = typescriptRuleTester({ ecmaVersion: 'latest', sourceType: 'module' });

tester.run(RULE_NAME, harnessPlugin.rules[RULE_NAME], {
  valid: [
    "import { getChatState, updateChatState } from './chat-state.utils.mjs'; getChatState(id);",
    "const dir = path.join(os.homedir(), '.cache', 'other-tool');",
    "const name = 'SHEAVLY_OTHER_DIR';",
    // Known gap, left to review (see rules.md): a folder built from pieces or a variable.
    "const dir = path.join(home, ['sheavly', 'harness'].join('-'));",
  ],
  invalid: [
    'const dir = process.env.SHEAVLY_HOOK_STATE_DIR;',
    "const dir = path.join(os.homedir(), '.cache', 'sheavly-harness', 'chats');",
    "const dir = '.cache/sheavly-harness/chats';",
    'const dir = `${home}/.cache/sheavly-harness/chats`;',
    'const dir = process.env[`SHEAVLY_HOOK_STATE_DIR`];',
    'const { SHEAVLY_HOOK_STATE_DIR: dir } = process.env;',
    "process.env['SHEAVLY_HOOK_STATE_DIR'] = x;",
  ].map((code) => ({ code, errors: [{ messageId: 'm0' }] })),
});

const on = (file) => ruleIsErrorOn({ rule: `harness/${RULE_NAME}`, folder: '.', file });

describe('no-adhoc-chat-state in the hooks', () => {
  it('is on for every hook but the state module', async () => {
    for (const file of [
      '.cursor/hooks/require-issue.mjs',
      '.cursor/hooks/hooks.utils.mjs',
      '.cursor/hooks/record-shell-writes.mjs',
      '.cursor/hooks/shell-snapshots.utils.mjs',
    ]) {
      expect(await on(file), file).toBe(true);
    }
  });

  it('is off only for the state module, and for tests, which point it at a temp folder', async () => {
    for (const file of [
      '.cursor/hooks/chat-state.utils.mjs',
      '.cursor/hooks/__tests__/chat-state.utils.test.mjs',
      '.cursor/hooks/__tests__/run-hook.utils.mjs',
    ]) {
      expect(await on(file), file).toBe(false);
    }
  });
});
