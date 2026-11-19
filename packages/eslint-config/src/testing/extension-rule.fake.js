import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruleIsErrorOn } from './coding-rule.fake.js';

/** This repo's root, for the tests that lint its real extensions. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

const manifest = (name, domain) => ({ name, sheavly: { domain } });

/** The throwaway monorepo the extension rules run in: extensions, a package and an app. */
export const EXTENSION_WORKSPACES = {
  'package.json': { name: 'monorepo', workspaces: ['apps/*', 'extensions/*', 'packages/*'] },
  'apps/cli/package.json': manifest('@sheavly/cli', 'coding'),
  'extensions/web/package.json': manifest('@sheavly/web', 'generic'),
  'extensions/agents/package.json': manifest('@sheavly/agents', 'generic'),
  'packages/extension/package.json': manifest('@sheavly/extension', 'generic'),
  'packages/base/package.json': manifest('@sheavly/base', 'generic'),
};

/** `[folder, file, enabled]`: where an extension rule is an error in the real config. */
const EXTENSION_RULE_ROWS = [
  ['extensions/agents', 'src/x/x.helper.ts', true],
  ['extensions/web', 'src/x/x.helper.ts', true],
  ['extensions/coding', 'src/x/x.helper.ts', true],
  ['extensions/web', 'src/x/__tests__/x.helper.test.ts', false],
  ['packages/host', 'src/x/x.helper.ts', false],
  ['apps/backend', 'src/x/x.helper.ts', false],
];

/** Lints `code` as `file` (from the repo root) with `eslint` and returns its messages. */
export async function messagesOfText(params) {
  const { eslint, code, file } = params;
  const [result] = await eslint.lintText(code, { filePath: path.join(REPO_ROOT, file) });

  return result?.messages ?? [];
}

/** Asserts, per `EXTENSION_RULE_ROWS`, that the real config turns `rule` on where it should. */
export function describeRuleIsOnInExtensions(rule) {
  describe(`${rule} is on`, () => {
    it.each(EXTENSION_RULE_ROWS)('%s %s: %s', async (folder, file, expected) => {
      expect(await ruleIsErrorOn({ rule, folder, file })).toBe(expected);
    });
  });
}

/**
 * What `rule` reports over the source of every real extension (empty when there is none), each as
 * the file's path from the repo root and the message.
 */
export async function violationsInExtensions(params) {
  const { eslint, rule } = params;
  const results = await eslint.lintFiles(['extensions/*/src/**/*.ts']);

  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === rule)
      .map((message) => `${path.relative(REPO_ROOT, result.filePath)}: ${message.message}`),
  );
}
