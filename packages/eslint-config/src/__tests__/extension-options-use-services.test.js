import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import {
  RUN_SERVICES_FILE,
  readRunServices,
  readRunServiceTypes,
} from '../run-service-types.utils.js';
import { repoRuleLinter, ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const RULE = 'harness/extension-options-use-services';

const SERVICES = `
export const PROVIDER = defineService<Provider>('provider');
export const INSTRUCTIONS = defineService<string>('instructions');
export const SESSIONS = defineService<SessionRegistry>('sessions');
export const MAIN_SESSION = defineService<SessionRef>('main-session');
export const TASKS = defineService<TaskRegistry>('tasks');
export const APPROVALS = defineService<ApprovalRequester>('approvals');
export const OUTPUTS = defineService<OutputStore>('outputs');
`;
const FOO = "export const FOO = defineService<FooRegistry>('foo');\n";

const workspaces = {
  'package.json': { name: 'monorepo', workspaces: ['packages/*', 'extensions/*', 'apps/*'] },
  'packages/base/package.json': { name: '@sheavly/base', sheavly: { domain: 'generic' } },
  'extensions/web/package.json': { name: '@sheavly/web', sheavly: { domain: 'generic' } },
  'apps/cli/package.json': { name: '@sheavly/cli', sheavly: { domain: 'coding' } },
};
const rootWith = (services) => tempWorkspace({ ...workspaces, [RUN_SERVICES_FILE]: services });
const root = rootWith(SERVICES);
const options = [{ root }];
const at = (file) => path.join(root, file);
const web = at('extensions/web/src/web/web.types.ts');
const alias = (body) => `export type WebExtensionOptions = { ${body} };`;
const problem = (property, type, key) => ({ messageId: 'runState', data: { property, type, key } });

typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' }).run(
  'extension-options-use-services',
  harnessPlugin.rules['extension-options-use-services'],
  {
    valid: [
      // Choices: strings, booleans, functions.
      {
        code: alias('name: string; verbose?: boolean; summarize: (text: string) => string'),
        filename: web,
        options,
      },
      { code: alias('harness: CodingHarness'), filename: web, options },
      // Only `*ExtensionOptions` is checked.
      {
        code: 'export type WebFetchOptions = { tasks: TaskRegistry };',
        filename: web,
        options,
      },
      {
        code: 'export interface CommandPermissions { outputs: OutputStore }',
        filename: web,
        options,
      },
      // Tests, packages and apps are not checked.
      {
        code: alias('sessions: SessionRegistry'),
        filename: at('extensions/web/src/web/__tests__/web.types.test.ts'),
        options,
      },
      {
        code: alias('sessions: SessionRegistry'),
        filename: at('packages/base/src/b/b.types.ts'),
        options,
      },
      { code: alias('sessions: SessionRegistry'), filename: at('apps/cli/src/m.ts'), options },
      // A type the run-services file lacks is not a service type.
      {
        code: alias('foo: FooRegistry'),
        filename: web,
        options,
      },
      // A name the file declares itself is not the host's type.
      { code: `type Provider = 'a' | 'b';\n${alias('p: Provider')}`, filename: web, options },
      {
        code: `export type WebExtensionOptions<Provider> = { p: Provider };`,
        filename: web,
        options,
      },
      {
        code: `interface TaskRegistry { x: 1 }\n${alias('t: TaskRegistry')}`,
        filename: web,
        options,
      },
      { code: `enum Provider { A }\n${alias('p: Provider')}`, filename: web, options },
      { code: alias('run(s: string): void; [k: string]: number'), filename: web, options },
      { code: 'export type WebExtensionOptions = Partial<{ a: string }>;', filename: web, options },
      // Without the run-services file there is nothing to check, and nothing crashes.
      {
        code: alias('sessions: SessionRegistry'),
        filename: web,
        options: [{ root: tempWorkspace(workspaces) }],
      },
    ],
    invalid: [
      {
        code: alias('sessions: SessionRegistry'),
        filename: web,
        options,
        errors: [problem('sessions', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: alias('tasks?: TaskRegistry'),
        filename: web,
        options,
        errors: [problem('tasks', 'TaskRegistry', 'TASKS')],
      },
      {
        code: alias('provider: Provider | undefined'),
        filename: web,
        options,
        errors: [problem('provider', 'Provider', 'PROVIDER')],
      },
      {
        code: alias('outputs: OutputStore'),
        filename: web,
        options,
        errors: [problem('outputs', 'OutputStore', 'OUTPUTS')],
      },
      {
        code: alias('main: SessionRef; approve: ApprovalRequester'),
        filename: web,
        options,
        errors: [
          problem('main', 'SessionRef', 'MAIN_SESSION'),
          problem('approve', 'ApprovalRequester', 'APPROVALS'),
        ],
      },
      // Arrays, generic arguments and nested literals mention it too.
      {
        code: alias('all: readonly SessionRegistry[]; later: Promise<TaskRegistry>'),
        filename: web,
        options,
        errors: [
          problem('all', 'SessionRegistry', 'SESSIONS'),
          problem('later', 'TaskRegistry', 'TASKS'),
        ],
      },
      {
        code: alias('inner: Readonly<{ x: TaskRegistry }>'),
        filename: web,
        options,
        errors: [problem('inner', 'TaskRegistry', 'TASKS')],
      },
      {
        code: 'export type WebExtensionOptions = Readonly<{ x: TaskRegistry }>;',
        filename: web,
        options,
        errors: [problem('x', 'TaskRegistry', 'TASKS')],
      },
      {
        code: alias('nested: { deeper: { sessions: SessionRegistry } }'),
        filename: web,
        options,
        errors: [problem('nested', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: 'export interface WebExtensionOptions { sessions: SessionRegistry }',
        filename: web,
        options,
        errors: [problem('sessions', 'SessionRegistry', 'SESSIONS')],
      },
      // Every member shape, function-typed ones included.
      {
        code: alias('run(s: SessionRegistry): void'),
        filename: web,
        options,
        errors: [problem('run', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: alias('run: (s: SessionRegistry) => void'),
        filename: web,
        options,
        errors: [problem('run', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: alias('[k: string]: TaskRegistry'),
        filename: web,
        options,
        errors: [problem('[k: …]', 'TaskRegistry', 'TASKS')],
      },
      {
        code: alias('(s: SessionRegistry): void'),
        filename: web,
        options,
        errors: [problem('(call signature)', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: alias('new (t: TaskRegistry): object'),
        filename: web,
        options,
        errors: [problem('(construct signature)', 'TaskRegistry', 'TASKS')],
      },
      // A whole body that is a reference or wrapper names the alias.
      {
        code: 'export type WebExtensionOptions = Partial<SessionRegistry>;',
        filename: web,
        options,
        errors: [problem('WebExtensionOptions', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: 'export type WebExtensionOptions = { a: string } | SessionRegistry;',
        filename: web,
        options,
        errors: [problem('WebExtensionOptions', 'SessionRegistry', 'SESSIONS')],
      },
      // An interface's `extends` and generic constraints and defaults.
      {
        code: 'export interface WebExtensionOptions extends SessionRegistry { a: string }',
        filename: web,
        options,
        errors: [problem('extends SessionRegistry', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: 'export type WebExtensionOptions<T extends TaskRegistry = TaskRegistry> = { t: T };',
        filename: web,
        options,
        errors: [problem('T', 'TaskRegistry', 'TASKS'), problem('T', 'TaskRegistry', 'TASKS')],
      },
      // Import types and qualified names (matched by the right-hand name).
      {
        code: alias("s: import('x').SessionRegistry"),
        filename: web,
        options,
        errors: [problem('s', 'SessionRegistry', 'SESSIONS')],
      },
      {
        code: `import * as Sdk from 'sdk';\n${alias('p: Sdk.Provider')}`,
        filename: web,
        options,
        errors: [problem('p', 'Provider', 'PROVIDER')],
      },
    ],
  },
);

describe('the service types are read from the run-services file, not listed', () => {
  const foo = alias('foo: FooRegistry');
  const lint = async (services, code = foo) => {
    const own = rootWith(services);
    const eslint = new ESLint({
      cwd: own,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser },
          plugins: { harness: harnessPlugin },
          rules: { [RULE]: ['error', { root: own }] },
        },
      ],
    });
    const file = path.join(own, 'extensions/web/src/web/web.types.ts');
    const [result] = await eslint.lintText(code, { filePath: file });

    return result.messages.map(({ message }) => message);
  };

  it('does not crash or report on a clean options type when the file does not parse', async () => {
    expect(await lint('export const = ;', alias('name: string'))).toEqual([]);
  });

  it('reports once, naming the file, when it parses but yields no service keys', async () => {
    const messages = await lint("export const X = wrap<Foo>('x');", alias('name: string'));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(RUN_SERVICES_FILE);
  });

  it('joins the keys of two services that share one type name', async () => {
    const messages = await lint(
      `${SERVICES}export const OTHER = defineService<SessionRef>('other');`,
      alias('main: SessionRef'),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('MAIN_SESSION or OTHER');
  });

  it('treats a directory at the run-services path as missing instead of crashing', () => {
    const own = tempWorkspace(workspaces);

    mkdirSync(path.join(own, RUN_SERVICES_FILE), { recursive: true });

    expect(readRunServices(own).state).toBe('missing');
    expect(readRunServiceTypes(own).size).toBe(0);
  });

  it('keeps every key of a shared type name in the parsed map', () => {
    const own = rootWith(`${SERVICES}export const OTHER = defineService<SessionRef>('other');`);

    expect(readRunServiceTypes(own).get('SessionRef')).toBe('MAIN_SESSION or OTHER');
  });

  it('reports a type a new defineService line adds', async () => {
    const messages = await lint(SERVICES + FOO);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`services.get(FOO)` in `activate`');
  });

  it('does not report it when the file lacks that line', async () => {
    expect(await lint(SERVICES)).toEqual([]);
  });

  it('maps each named type to its key and leaves primitives out', () => {
    const types = readRunServiceTypes(root);

    expect(types.get('SessionRegistry')).toBe('SESSIONS');
    expect(types.has('string')).toBe(false);
    expect(types.size).toBe(6);
  });

  it("finds the host's run services in this repo", () => {
    const types = readRunServiceTypes(REPO_ROOT);

    expect(types.get('SessionInfoView')).toBe('SESSION_INFO');
    expect(types.get('TaskControl')).toBe('TASK_CONTROL');
    expect(types.get('Provider')).toBe('MODEL');
    expect(types.get('OutputReader')).toBe('OUTPUT_READER');
  });
});

describe('harness/extension-options-use-services is on', () => {
  const where = [
    ['extensions/agents', 'src/x/x.types.ts', true],
    ['extensions/web', 'src/x/x.types.ts', true],
    ['extensions/coding', 'src/x/x.types.ts', true],
    ['extensions/web', 'src/web/__tests__/web.helper.test.ts', false],
    ['packages/core', 'src/x/x.types.ts', false],
    ['apps/backend', 'src/x/x.types.ts', false],
  ];

  it.each(where)('%s %s: %s (source of an extension only, so options are held)', async (...row) => {
    const [folder, file, expected] = row;

    expect(await ruleIsErrorOn({ rule: RULE, folder, file })).toBe(expected);
  });
});

describe("this repo's extensions", () => {
  const optionTypes = [
    'extensions/agents/src/agents/agents.types.ts',
    'extensions/web/src/web/web.types.ts',
    'extensions/coding/src/extension/coding-extension.types.ts',
  ];

  it.each(optionTypes)('%s takes choices, never run state the services carry', async (file) => {
    const [result] = await repoRuleLinter(RULE).lintFiles([file]);

    expect(result.messages).toEqual([]);
    expect(result.filePath).toBe(path.join(REPO_ROOT, file));
  });
});
