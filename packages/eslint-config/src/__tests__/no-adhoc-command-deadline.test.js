import { describe, expect, it } from 'vitest';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { harnessPlugin } from '../plugin.js';

const RULE_NAME = 'no-adhoc-command-deadline';
const deadlineTester = typescriptRuleTester({ ecmaVersion: 'latest', sourceType: 'module' });

deadlineTester.run(RULE_NAME, harnessPlugin.rules[RULE_NAME], {
  valid: [
    'const { signal, timedOut } = withDeadline({ signal: caller, timeoutMs });',
    'const aborted = AbortSignal.any([a, b]);',
    'const done = AbortSignal.abort();',
    'const wait = timeoutMs * 2;',
    // Known gaps, left to review (see rules.md): a renamed import, a global-object spelling and a
    // timeout handed to a child process.
    "import { setTimeout as sleep } from 'node:timers/promises'; await sleep(10);",
    'const timer = globalThis.setTimeout(done, 10);',
    "const child = spawn('sleep', ['5'], { timeout: 10 });",
  ],
  invalid: [
    { code: 'const limit = AbortSignal.timeout(timeoutMs);', errors: [{ messageId: 'm0' }] },
    { code: 'const timer = setTimeout(() => kill(), timeoutMs);', errors: [{ messageId: 'm1' }] },
    { code: 'const timer = setInterval(check, 100);', errors: [{ messageId: 'm1' }] },
  ],
});

const WORKSPACE = 'packages/workspace';
const on = (file) => ruleIsErrorOn({ rule: `harness/${RULE_NAME}`, folder: WORKSPACE, file });

// The one exception is pinned: a renamed helper or a widened override changes these answers.
describe('no-adhoc-command-deadline in the workspace package', () => {
  it('is on for the runner and the script helper, so each reads its deadline from withDeadline', async () => {
    for (const file of ['src/process/process.service.ts', 'src/process/script.helper.ts']) {
      expect(await on(file), file).toBe(true);
    }
  });

  it('is off only for the helper that makes the deadline', async () => {
    expect(await on('src/process/deadline.helper.ts')).toBe(false);
  });

  it('is off in tests, which wait on real time, and outside the process folder', async () => {
    for (const file of ['src/process/__tests__/x.test.ts', 'src/trust/trust.service.ts']) {
      expect(await on(file), file).toBe(false);
    }
  });
});
