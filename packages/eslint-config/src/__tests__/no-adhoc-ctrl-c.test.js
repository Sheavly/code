import { describe, expect, it } from 'vitest';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { harnessPlugin } from '../plugin.js';

const RULE_NAME = 'no-adhoc-ctrl-c';
const ctrlCTester = typescriptRuleTester({ ecmaVersion: 'latest', sourceType: 'module' });

ctrlCTester.run(RULE_NAME, harnessPlugin.rules[RULE_NAME], {
  valid: [
    'const ctrlC = interruptOnCtrlC({ write, stop, forceQuit, source: input });',
    "process.once('SIGTERM', onTerminate);",
    "process.on('exit', onExit);",
    "input.on('close', onClose);",
    'process.off(signal, listener);',
    // Known gaps, left to review (see rules.md): a signal name in a variable.
    'process.on(name, listener);',
  ],
  invalid: [
    "process.on('SIGINT', onSigint);",
    "process.once('SIGINT', onSigint);",
    "input.on('SIGINT', () => close());",
    "process.addListener('SIGINT', onSigint);",
    "process.prependListener('SIGINT', onSigint);",
  ].map((code) => ({ code, errors: [{ messageId: 'm0' }] })),
});

const TERMINAL = 'apps/terminal';
const on = (file) => ruleIsErrorOn({ rule: `harness/${RULE_NAME}`, folder: TERMINAL, file });

// The one exception is pinned: a renamed helper or a widened override changes these answers.
describe('no-adhoc-ctrl-c in the terminal app', () => {
  it('is on for the entry points, the chat, the demo and the workbook', async () => {
    for (const file of [
      'src/demo.ts',
      'src/chat/line-chat.helper.ts',
      'src/demo/demo.helper.ts',
      'src/workbook/run.helper.ts',
    ]) {
      expect(await on(file), file).toBe(true);
    }
  });

  it('is off only for the helper that installs the listener, and in tests', async () => {
    for (const file of [
      'src/interrupt/interrupt.helper.ts',
      'src/interrupt/__tests__/interrupt.helper.test.ts',
    ]) {
      expect(await on(file), file).toBe(false);
    }
  });
});
