import path from 'node:path';
import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const STORAGE = path.resolve(import.meta.dirname, '../../../storage');
const eslint = new ESLint({ cwd: STORAGE });

const PROFILE_SCHEMA =
  "import { profileSchema } from '@sheavly/protocol/profile/profile.validator';";
const INDEX_SCHEMA =
  "import { storedConversationSchema } from '@sheavly/protocol/store/store.validator';";
const OTHER_NAMES =
  "import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator'; import { storedConversationsResponseSchema } from '@sheavly/protocol/store/store.validator';";

/** The ids of the rules `code` breaks, linted with the rules the storage package has for `file`. */
async function broken(params) {
  const { code, file } = params;
  const config = await eslint.calculateConfigForFile(path.join(STORAGE, file));
  const entry = config?.rules['no-restricted-imports'];
  const rules = Array.isArray(entry) && entry[0] === 2 ? { 'no-restricted-imports': entry } : {};
  const messages = new Linter().verify(
    code,
    [
      {
        files: ['**/*.js'],
        languageOptions: { sourceType: 'module', ecmaVersion: 'latest' },
        rules,
      },
    ],
    'stored-file.js',
  );

  return messages.map((message) => message.ruleId);
}

// A store that parses profile.json or index.json with the plain protocol schema would reject every
// file written before "mode" became "effort". What a reader does with the parsed value, and a
// schema copied under another name, stay with review.
describe('reading a stored profile or conversation index in the storage package', () => {
  it.each([
    ['src/profile-store/profile-store.service.ts', PROFILE_SCHEMA],
    ['src/profile-registry/open-profile.service.ts', PROFILE_SCHEMA],
    ['src/conversation-store/conversation-store.service.ts', INDEX_SCHEMA],
    ['src/conversation-store/history-file.service.ts', INDEX_SCHEMA],
  ])('refuses the plain schema in %s', async (file, code) => {
    expect(await broken({ code, file })).toEqual(['no-restricted-imports']);
  });

  it.each([
    'src/profile-store/profile-store.service.ts',
    'src/conversation-store/conversation-store.service.ts',
  ])('lets %s import the other schemas of those modules', async (file) => {
    expect(await broken({ code: OTHER_NAMES, file })).toEqual([]);
  });

  it.each([
    'src/legacy-effort/legacy-effort.validator.ts',
    'src/profile-store/__tests__/profile-store.service.test.ts',
    'src/conversation-store/__tests__/conversation-store.service.test.ts',
  ])('leaves %s free to use the plain schemas', async (file) => {
    expect(await broken({ code: `${PROFILE_SCHEMA} ${INDEX_SCHEMA}`, file })).toEqual([]);
  });
});
