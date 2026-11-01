import path from 'node:path';
import { FILE_KINDS, kindOfFile, TEST_FOLDER } from '../file-kinds.js';

// Reads the kind off the file name, so a new
// file is covered with no glob to keep in sync.

/** Every module file is `<name>.<kind>.ts`; tests in `__tests__/`, and only tests there. */
export const fileKind = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      badName: `Name files \`<name>.<kind>.ts\` in kebab-case (\`tasks.service.ts\`), with kind one of: ${FILE_KINDS.join(', ')}. A genuinely new kind is added with its policy to FILE_KIND_POLICIES in eslint/file-kinds.js.`,
      testOutsideFolder: `Move this test into a \`${TEST_FOLDER}\` folder beside the module it tests (\`<module>/${TEST_FOLDER}/<name>.<kind>.test.ts\`); Vitest only runs tests there.`,
      nonTestInFolder: `Only \`*.test.ts\` files go in \`${TEST_FOLDER}\`; shared test helpers go in src/testing/ as \`*.fake.ts\`.`,
    },
  },
  create(context) {
    const kind = kindOfFile(context.filename);

    if (!kind) return { Program: (node) => context.report({ node, messageId: 'badName' }) };

    const inTestFolder = path.basename(path.dirname(context.filename)) === TEST_FOLDER;
    let messageId = null;

    if (kind === 'test' && !inTestFolder) messageId = 'testOutsideFolder';
    if (kind !== 'test' && inTestFolder) messageId = 'nonTestInFolder';

    return messageId ? { Program: (node) => context.report({ node, messageId }) } : {};
  },
};
