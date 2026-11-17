import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const ruleTester = typescriptRuleTester({ sourceType: 'module' });
const REPO = path.resolve(import.meta.dirname, '../../../..');

// An id in a type is a branded type, so a session's id can't go where a task's does.
ruleTester.run('branded-ids (types)', harnessPlugin.rules['branded-ids'], {
  valid: [
    'type Read = { agentId: SessionId; file: string };',
    'interface Read { agentId: SessionId }',
    'function f(params: { agentId: SessionId; file: string }) {}',
    'type Read = { agentId?: SessionId | undefined };',
    // Not ids: names, and words that only end in "id" (`paid`, `valid`).
    'type Row = { title: string; paid: string; valid: string; identity: string };',
    // A member with no annotation, and a non-string id.
    'type Row = { agentId };',
    'type Row = { id: number };',
  ],
  invalid: [
    'type Read = { agentId: string; file: string };',
    'interface Read { agentId: string }',
    'function f(params: { agentId: string; file: string }) {}',
    'type Read = { id: string };',
    'type Read = { taskId?: string | undefined };',
    "type Read = { 'callId': string };",
  ].map((code) => ({ code, errors: [{ messageId: 'unbrandedType' }] })),
});

const ruleOn = (file, folder) =>
  ruleIsErrorOn({ rule: 'harness/branded-ids', file, folder: folder ?? 'packages/workspace' });

describe('branded-ids is enabled for types', () => {
  it.each([
    ['src/file-reads/file-reads.service.ts', 'packages/workspace'],
    ['src/file-reads/file-reads.types.ts', 'packages/workspace'],
    ['src/files/files.utils.ts', 'extensions/coding'],
    ['src/harness/file-reads.helper.ts', 'apps/backend'],
  ])('for %s in %s', async (file, folder) => {
    expect(await ruleOn(file, folder)).toBe(true);
  });

  it.each([
    ['src/file-reads/__tests__/file-reads.service.test.ts', 'packages/workspace'],
    ['src/testing/file-reads.fake.ts', 'packages/workspace'],
  ])('not for %s in %s (fixtures)', async (file, folder) => {
    expect(await ruleOn(file, folder)).toBe(false);
  });

  it('checks no types in a prompt file, whose members are the text it prints', async () => {
    const cwd = path.join(REPO, 'extensions/coding');
    const config = await new ESLint({ cwd }).calculateConfigForFile(
      path.join(cwd, 'src/run-command/run-command.prompt.ts'),
    );

    expect(config?.rules['harness/branded-ids']).toEqual([2, { types: false }]);
  });

  it.each([
    ['src/safe-path/safe-path.helper.ts', 'packages/storage'],
    ['src/api/api.utils.ts', 'packages/protocol'],
    ['src/sections/sections.types.ts', 'packages/summary'],
    ['src/client/entries.helper.ts', 'packages/client'],
    ['src/render/render.service.ts', 'apps/terminal'],
  ])('for %s in %s (no workspace is exempt)', async (file, folder) => {
    expect(await ruleOn(file, folder)).toBe(true);
  });

  it('still checks the schemas of a validator and a tool in every workspace', async () => {
    expect(await ruleOn('src/session/session.validator.ts', 'packages/protocol')).toBe(true);
    expect(await ruleOn('src/read-file/read-file.tool.ts', 'extensions/coding')).toBe(true);
  });
});
