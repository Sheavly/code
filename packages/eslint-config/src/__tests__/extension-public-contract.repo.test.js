import { describe, expect, it } from 'vitest';
import { readExtensionContract } from '../extension-contract.utils.js';
import { repoRuleLinter } from '../testing/coding-rule.fake.js';
import {
  describeRuleIsOnInExtensions,
  messagesOfText,
  REPO_ROOT,
  violationsInExtensions,
} from '../testing/extension-rule.fake.js';

const RULE = 'harness/extension-public-contract';

describe('the contract of this repo', () => {
  const contract = readExtensionContract(REPO_ROOT);

  it.each([
    ['SESSION_INFO', '@sheavly/extension/run-services/run-services.utils'],
    ['SessionInfoView', '@sheavly/extension/run-services/run-services.types'],
    ['OutputReader', '@sheavly/extension/run-services/run-services.types'],
    ['ScopeDeactivatedError', '@sheavly/extension/errors/scopes.errors'],
  ])('exposes %s', (name, from) => {
    expect(contract.size).toBeGreaterThan(0);
    expect(contract.get(name)).toBe(from);
  });
});

describe('the extensions of this repo', () => {
  const eslint = repoRuleLinter(RULE);

  it('import the contract only from @sheavly/extension, and never the host', async () => {
    expect(await violationsInExtensions({ eslint, rule: RULE })).toEqual([]);
  });

  it('fail a file that takes a service key from the host', async () => {
    const messages = await messagesOfText({
      eslint,
      code: "import { SESSION_INFO } from '@sheavly/host/run-services/run-services.utils';",
      file: 'extensions/coding/src/extension/not-listed.helper.ts',
    });

    expect(messages.map((message) => message.ruleId)).toEqual([RULE]);
  });
});

describeRuleIsOnInExtensions(RULE);
