import { describe, expect, it } from 'vitest';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';

const RULE = 'harness/no-adhoc-unknown-approval';
const on = (params) => ruleIsErrorOn({ rule: RULE, ...params });

// The exceptions are pinned: a renamed file or a widened override changes these answers, and the
// rule's own cases are in fail-loudly.test.js.
describe('no-adhoc-unknown-approval', () => {
  it('is on for the UIs that answer approvals, so they use answerWhileWaiting', async () => {
    expect(await on({ folder: 'apps/terminal', file: 'src/tui/screen-chat.helper.ts' })).toBe(true);
    expect(
      await on({ folder: 'apps/terminal', file: 'src/workbook/check-approvals.service.ts' }),
    ).toBe(true);
    expect(await on({ folder: 'apps/terminal', file: 'src/client/conversation.service.ts' })).toBe(
      true,
    );
  });

  it('is on in the client package except for the helper that defines the rule', async () => {
    expect(await on({ folder: 'packages/client', file: 'src/client/client.helper.ts' })).toBe(true);
    expect(await on({ folder: 'packages/client', file: 'src/approvals/approvals.helper.ts' })).toBe(
      false,
    );
  });

  it('is off only where the code is defined or produced', async () => {
    expect(await on({ folder: 'packages/protocol', file: 'src/server/server.validator.ts' })).toBe(
      false,
    );
    expect(
      await on({ folder: 'packages/protocol', file: 'src/approval/approval.validator.ts' }),
    ).toBe(true);
    expect(await on({ folder: 'apps/backend', file: 'src/api/api.utils.ts' })).toBe(false);
    expect(await on({ folder: 'apps/backend', file: 'src/api/handlers.helper.ts' })).toBe(true);
  });

  it('is off in tests, which assert on the code', async () => {
    expect(
      await on({
        folder: 'apps/terminal',
        file: 'src/client/__tests__/conversation.service.test.ts',
      }),
    ).toBe(false);
  });
});
