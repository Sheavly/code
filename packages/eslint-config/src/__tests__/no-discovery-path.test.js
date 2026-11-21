import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

// Where the server holds its lock and publishes its discovery file is resolved in storage's
// runtime folder and discovery-file folder: no other source reads the variable or names the file.
const ruleTester = typescriptRuleTester();

const reports = (code) => ({ code, errors: 1 });

ruleTester.run('no-discovery-path', harnessPlugin.rules['no-discovery-path'], {
  valid: [
    // Going through the modules that own the path is the way.
    "import { serverRuntimeDirectory } from '@sheavly/storage/server-runtime/server-runtime.helper'; const folder = await serverRuntimeDirectory(options);",
    "import { DISCOVERY_FILE_NAME } from '@sheavly/protocol/discovery/discovery.constants'; const file = path.join(folder, DISCOVERY_FILE_NAME);",
    // Names that only share a word with the two.
    "const word = 'server';",
    "const word = 'json';",
    "const word = 'XDG';",
    "const file = 'servers.json';",
    "const file = 'server-json';",
    "const variable = 'XDG_CONFIG_HOME';",
    'const file = `${dir}/config.json`;',
  ],
  invalid: [
    // The variable, however it is read.
    reports('const dir = process.env.XDG_RUNTIME_DIR;'),
    reports("const dir = env['XDG_RUNTIME_DIR'];"),
    reports('const { XDG_RUNTIME_DIR: dir } = process.env;'),
    reports("const name = 'XDG_RUNTIME_DIR';"),
    reports("const { value } = { value: 'XDG_RUNTIME_DIR' };"),
    reports('const name = `XDG_RUNTIME_DIR`;'),
    // The file, however it is joined.
    reports("const file = path.join(folder, 'server.json');"),
    reports('const file = `${dir}/server.json`;'),
    reports("const file = dir + '/server.json';"),
    reports("const config = { file: 'server.json' };"),
    reports("const file = 'server.json';"),
    // A name that contains it still resolves the path, so a derived name fails too.
    reports("const temp = 'server.json.tmp';"),
    reports("const file = '/run/user/1000/sheavly/server.json';"),
  ],
});

const on = (params) => ruleIsErrorOn({ rule: 'harness/no-discovery-path', ...params });

// The exceptions are pinned: a renamed folder or a widened override changes these answers.
describe('no-discovery-path', () => {
  it('is on for the code that could rebuild the path', async () => {
    expect(await on({ folder: 'apps/backend', file: 'src/server/server.helper.ts' })).toBe(true);
    expect(await on({ folder: 'apps/terminal', file: 'src/client/discovery.helper.ts' })).toBe(
      true,
    );
    expect(
      await on({ folder: 'packages/storage', file: 'src/json-file/json-file.helper.ts' }),
    ).toBe(true);
    expect(await on({ folder: 'packages/protocol', file: 'src/server/server.validator.ts' })).toBe(
      true,
    );
  });

  it('is off only in the runtime folder, the discovery file module and the protocol constant', async () => {
    expect(
      await on({
        folder: 'packages/storage',
        file: 'src/server-runtime/server-runtime.helper.ts',
      }),
    ).toBe(false);
    expect(
      await on({
        folder: 'packages/storage',
        file: 'src/discovery-file/read-discovery-file.helper.ts',
      }),
    ).toBe(false);
    expect(
      await on({ folder: 'packages/protocol', file: 'src/discovery/discovery.constants.ts' }),
    ).toBe(false);
  });

  it('is off in tests, which plant and read the file by name', async () => {
    expect(
      await on({
        folder: 'packages/storage',
        file: 'src/json-file/__tests__/json-file.helper.test.ts',
      }),
    ).toBe(false);
    expect(
      await on({ folder: 'apps/backend', file: 'src/server/__tests__/server.helper.test.ts' }),
    ).toBe(false);
  });
});
