import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { connectBackendConfinement } from '../connect-backend-confinement.js';

const TERMINAL = path.resolve(import.meta.dirname, '../../../../apps/terminal');
const IMPORTS = 'no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';
const eslint = new ESLint({ cwd: TERMINAL });
const READ_FILE =
  "import { readDiscoveryFile } from '@sheavly/storage/discovery-file/read-discovery-file.helper';\nvoid readDiscoveryFile;\n";
const CLIENT_FILES = ['src/client/backend.helper.ts', 'src/client/with-backend.helper.ts'];
const OTHER_FILES = ['src/chat/start.helper.ts', 'src/workbook/store.service.ts', 'src/chat.ts'];

/** The messages of `rule` the terminal app's real config reports for `code` as `file`. */
async function reported(params) {
  const { code, file, rule = IMPORTS } = params;
  const [result] = await eslint.lintText(code, { filePath: path.join(TERMINAL, file) });

  return result.messages.filter(({ ruleId }) => ruleId === rule);
}

/** Whether the terminal app's config makes restricted imports an error for `file`. */
async function confines(file) {
  const resolved = await eslint.calculateConfigForFile(path.join(TERMINAL, file));
  const [severity] = resolved?.rules[IMPORTS] ?? [];

  return severity === 2;
}

// A development terminal must never silently attach to a stable server: the folder that starts its
// own backend reads no discovery file and takes no lock. Other terminal code may read the file
// (the `sheavly` command will), so the restriction is narrow. A static import and a dynamic
// `import('…')` of a string literal or a template literal without expressions are seen;
// `createRequire`, a raw `net.connect`, a path in a variable, a template literal with expressions
// and a relative path through `node_modules` are not, and stay with review.
describe('the terminal code that starts its own backend', () => {
  it('is an error for the client folder, and not for its tests', () => {
    expect(connectBackendConfinement.rules[IMPORTS][0]).toBe('error');
    expect(connectBackendConfinement.files).toEqual(['src/client/**/*.{ts,tsx,js,mjs}']);
    expect(connectBackendConfinement.ignores).toEqual(
      expect.arrayContaining(['src/client/**/__tests__/**', 'src/client/testing/**']),
    );
  });

  it('reports the discovery file reader in the file that holds connectBackend', async () => {
    const messages = await reported({ code: READ_FILE, file: 'src/client/backend.helper.ts' });

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('discovery file');
  });

  it.each([
    "import { readDiscoveryFile } from '@sheavly/storage/discovery-file/read-discovery-file.helper';",
    "import { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';",
    "import { acquireServerLock } from '@sheavly/storage/server-lock/server-lock.helper';",
    "import { serverRuntimeDirectory } from '@sheavly/storage/server-runtime/server-runtime.helper';",
  ])('refuses %s in every file of the client folder', async (line) => {
    for (const file of CLIENT_FILES) {
      expect(await reported({ code: `${line}\n`, file }), file).toHaveLength(1);
    }
  });

  it.each([
    ["void import('@sheavly/storage/discovery-file/read-discovery-file.helper');", 'dynamic'],
    ['void import("@sheavly/storage/server-lock/server-lock.helper");', 'dynamic'],
    ["void import('@sheavly/storage/server-runtime/server-runtime.helper');", 'dynamic'],
    ['void import(`@sheavly/storage/discovery-file/read-discovery-file.helper`);', 'template'],
    ['void import(`@sheavly/storage/server-lock/server-lock.helper`);', 'template'],
    ['void import(`@sheavly/storage/server-runtime/server-runtime.helper`);', 'template'],
  ])('reports %s (%s literal) in the client folder only', async (line) => {
    for (const file of CLIENT_FILES) {
      expect(await reported({ code: `${line}\n`, file, rule: SYNTAX }), file).toHaveLength(1);
    }

    for (const file of OTHER_FILES) {
      expect(await reported({ code: `${line}\n`, file, rule: SYNTAX }), file).toHaveLength(0);
    }
  });

  it('does not see a template literal with an expression, which stays with review', async () => {
    const code = 'const part = "x";\nvoid import(`@sheavly/storage/discovery-file/${part}`);\n';

    expect(
      await reported({ code, file: 'src/client/backend.helper.ts', rule: SYNTAX }),
    ).toHaveLength(0);
  });

  it('lets the client folder import the rest of storage with a template literal', async () => {
    const code = 'void import(`@sheavly/storage/home/home.helper`);\n';

    expect(
      await reported({ code, file: 'src/client/backend.helper.ts', rule: SYNTAX }),
    ).toHaveLength(0);
  });

  it('lets the client folder import the rest of storage dynamically', async () => {
    const code = "void import('@sheavly/storage/home/home.helper');\n";

    expect(
      await reported({ code, file: 'src/client/backend.helper.ts', rule: SYNTAX }),
    ).toHaveLength(0);
  });

  it('does not report the same import elsewhere in the terminal app', async () => {
    for (const file of OTHER_FILES) {
      expect(await reported({ code: READ_FILE, file }), file).toHaveLength(0);
    }
  });

  it('lets the client folder import the rest of storage', async () => {
    const code =
      "import { sheavlyHome } from '@sheavly/storage/home/home.helper';\nvoid sheavlyHome;\n";

    expect(await reported({ code, file: 'src/client/backend.helper.ts' })).toHaveLength(0);
  });

  it('applies to the client folder of the terminal app and to nothing else of it', async () => {
    for (const file of CLIENT_FILES) {
      expect(await confines(file), file).toBe(true);
    }

    for (const file of [...OTHER_FILES, 'src/client/__tests__/backend.helper.test.ts']) {
      expect(await confines(file), file).toBe(false);
    }
  });
});
