import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

ruleTester.run('no-handrolled-reply-reader', harnessPlugin.rules['no-handrolled-reply-reader'], {
  valid: [
    "import { readReply } from '../http/reply-reader.helper.js';",
    "import { parseToolArguments } from '../http/json.utils.js';",
    "import { readServerSentEvents } from './other-sse.js';",
  ],
  invalid: [
    {
      code: "import { readServerSentEvents } from '../http/sse.utils.js';",
      errors: [{ messageId: 'm0' }],
    },
    {
      code: "import { readServerSentEvents } from '@sheavly/providers/http/sse.utils';",
      errors: [{ messageId: 'm0' }],
    },
    { code: "const sse = await import('./sse.utils.js');", errors: [{ messageId: 'm0' }] },
    {
      code: "export { readServerSentEvents } from './sse.utils.js';",
      errors: [{ messageId: 'm0' }],
    },
  ],
});

const PROVIDERS = 'packages/providers';
const on = (file) =>
  ruleIsErrorOn({ rule: 'harness/no-handrolled-reply-reader', folder: PROVIDERS, file });

// The one exception is pinned: a renamed reader or a widened override changes these answers.
describe('no-handrolled-reply-reader in providers', () => {
  it('is on for every protocol, so each reads its reply through readReply', async () => {
    for (const file of [
      'src/responses/responses-stream.helper.ts',
      'src/chat-completions/chat-stream.helper.ts',
      'src/anthropic-messages/messages-stream.helper.ts',
      'src/gemini/gemini-stream.helper.ts',
    ]) {
      expect(await on(file), file).toBe(true);
    }
  });

  it('is off only for the shared reader', async () => {
    expect(await on('src/http/reply-reader.helper.ts')).toBe(false);
  });

  it('is off in tests, which read a body to check one', async () => {
    expect(await on('src/http/__tests__/sse.utils.test.ts')).toBe(false);
  });

  it('is on in another workspace', async () => {
    expect(
      await ruleIsErrorOn({
        rule: 'harness/no-handrolled-reply-reader',
        file: 'src/x/x.helper.ts',
      }),
    ).toBe(true);
  });
});
