// Where the rule applies and what it reads: exempt files, a missing manifest, the converse, and a
// mapping or keys file that changes or cannot be read.
import { harnessPlugin } from '../plugin.js';
import {
  ERRORS_FILE,
  grantCase,
  KEYS,
  KEYS_FILE,
  missing,
  RUN_SERVICE_GRANTS_FILE,
  TYPES,
  TYPES_FILE,
} from '../testing/grant-calls.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

const rule = harnessPlugin.rules['extension-declares-grants'];
const tester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const CALL = `import { SESSION_INFO } from '${KEYS}';
export const a = (services) => services.get(SESSION_INFO).list();`;
const LIST = missing('session-info.list', 'session:read');

tester.run('extension-declares-grants: tests, fakes and other workspaces are exempt', rule, {
  valid: [
    'extensions/web/src/web/__tests__/web.helper.test.ts',
    'extensions/web/src/testing/web.fake.ts',
    'packages/base/src/b/b.helper.ts',
    'apps/cli/src/main.ts',
  ].map((file) => grantCase({ code: CALL, grants: [], file })),
  invalid: [{ ...grantCase({ code: CALL, grants: [] }), errors: [LIST] }],
});

tester.run('extension-declares-grants: the manifest', rule, {
  valid: [
    // A missing or unreadable manifest is for the other rules to report.
    grantCase({ code: CALL, manifest: null }),
    grantCase({ code: CALL, manifest: '{ not json' }),
    grantCase({ code: CALL, manifest: { name: 'web', grants: 'session:read' } }),
    grantCase({ code: CALL, manifest: ['session:read'] }),
    // Any order, and extra grants.
    grantCase({ code: CALL, grants: ['task:start', 'session:read', 'model:call'] }),
  ],
  invalid: [
    // A manifest without `grants` declares none.
    { ...grantCase({ code: CALL, manifest: { name: 'web' } }), errors: [LIST] },
  ],
});

tester.run('extension-declares-grants: a declared grant no call needs is not reported', rule, {
  valid: [
    grantCase({ code: CALL, grants: ['session:read', 'model:call', 'task:cancel-any'] }),
    grantCase({ code: 'export const nothing = 1;', grants: ['model:call', 'session:read'] }),
  ],
  invalid: [],
});

const GROWN_MAPPING = `export const RUN_SERVICE_GRANTS = {
  'session-info': { list: 'session:read', purge: 'session:admin' },
  'brand-new': { go: 'new:go', 'goFar': { grant: 'new:far', arguments: { wide: 'new:wide' } } },
};`;
const GROWN_KEYS = `export const SESSION_INFO = defineService<SessionInfoView>('session-info');
export const BRAND_NEW = defineService<BrandNewView>('brand-new');`;
const GROWN_TYPES = `export type BrandNewView = { go: () => void };`;
const grown = {
  files: {
    [RUN_SERVICE_GRANTS_FILE]: GROWN_MAPPING,
    [KEYS_FILE]: GROWN_KEYS,
    [TYPES_FILE]: GROWN_TYPES,
  },
};
const GROWN_CALLS = `import { SESSION_INFO, BRAND_NEW } from '${KEYS}';
import type { BrandNewView } from '${TYPES}';
export const a = (services, typed: BrandNewView) => {
  services.get(SESSION_INFO).purge();
  services.get(BRAND_NEW).go();
  typed.go();
  services.get(BRAND_NEW).goFar({ wide: true });
};`;

tester.run('extension-declares-grants: a mapping that gains a method or a service', rule, {
  valid: [
    grantCase({
      ...grown,
      code: GROWN_CALLS,
      grants: ['session:admin', 'new:go', 'new:far', 'new:wide'],
    }),
  ],
  invalid: [
    {
      ...grantCase({
        ...grown,
        code: `import { SESSION_INFO, BRAND_NEW } from '${KEYS}';
import type { BrandNewView } from '${TYPES}';
export const a = (services, typed: BrandNewView) => {
  services.get(SESSION_INFO).purge();
  services.get(BRAND_NEW).go();
  typed.go();
};`,
        grants: ['session:read'],
      }),
      errors: [
        missing('session-info.purge', 'session:admin'),
        missing('brand-new.go', 'new:go'),
        missing('brand-new.go', 'new:go'),
      ],
    },
  ],
});

const TWO_KEYS = `export const KEY_A = defineService<Shared>('svc-a');
export const KEY_B = defineService<Shared>('svc-b');`;
const SHARED_TYPE = 'export type Shared = { first: () => void; second: () => void };';
const SHARED_MAPPING = `export const RUN_SERVICE_GRANTS = {
  'svc-a': { first: 'a:first' },
  'svc-b': { second: 'b:second' },
} as const;`;
const shared = {
  files: {
    [KEYS_FILE]: TWO_KEYS,
    [TYPES_FILE]: SHARED_TYPE,
    [RUN_SERVICE_GRANTS_FILE]: SHARED_MAPPING,
  },
};
const SHARED_CALLS = `import type { Shared } from '${TYPES}';
export const a = (s: Shared) => { s.first(); s.second(); };`;

tester.run('extension-declares-grants: one type carried by two keys', rule, {
  valid: [grantCase({ ...shared, code: SHARED_CALLS, grants: ['a:first', 'b:second'] })],
  invalid: [
    {
      ...grantCase({ ...shared, code: SHARED_CALLS, grants: [] }),
      errors: [missing('svc-a.first', 'a:first'), missing('svc-b.second', 'b:second')],
    },
  ],
});

const UNEXPECTED_MAPPINGS = {
  'a call':
    "export const RUN_SERVICE_GRANTS = build({ 'session-info': { list: 'session:read' } });",
  'a spread':
    "export const RUN_SERVICE_GRANTS = { ...other, 'session-info': { list: 'session:read' } };",
  'a computed key':
    "export const RUN_SERVICE_GRANTS = { ['session-info']: { list: 'session:read' } };",
  'a number': "export const RUN_SERVICE_GRANTS = { 'session-info': { list: 3 } };",
  'a member that is not an entry':
    "export const RUN_SERVICE_GRANTS = { 'session-info': { list: { grant: 'session:read' } } };",
  'no table': "export const OTHER = { 'session-info': { list: 'session:read' } };",
  'an empty file': '',
};

const UNREADABLE = {
  messageId: 'unreadable',
  data: { file: RUN_SERVICE_GRANTS_FILE },
};

tester.run(
  'extension-declares-grants: a mapping that exists but cannot be read is reported',
  rule,
  {
    valid: [
      // Only a missing file or a syntax error (for the compiler to report) stays silent.
      grantCase({ code: CALL, grants: [], omit: [RUN_SERVICE_GRANTS_FILE] }),
      grantCase({
        code: CALL,
        grants: [],
        files: { [RUN_SERVICE_GRANTS_FILE]: 'export const RUN_SERVICE_GRANTS = {{{' },
      }),
      grantCase({ code: CALL, grants: [], omit: [KEYS_FILE] }),
      grantCase({ code: CALL, grants: [], files: { [KEYS_FILE]: 'export const {{{' } }),
      grantCase({ code: CALL, grants: [], omit: [KEYS_FILE, TYPES_FILE, ERRORS_FILE] }),
    ],
    invalid: [
      ...Object.entries(UNEXPECTED_MAPPINGS).map(([, mapping]) => ({
        ...grantCase({ code: CALL, grants: [], files: { [RUN_SERVICE_GRANTS_FILE]: mapping } }),
        errors: [UNREADABLE],
      })),
      // Once per linted file, however many calls it makes.
      {
        ...grantCase({
          code: `${CALL}\nexport const b = (services) => services.get(SESSION_INFO).get('s');`,
          grants: [],
          files: { [RUN_SERVICE_GRANTS_FILE]: 'export const RUN_SERVICE_GRANTS = { ...other };' },
        }),
        errors: [UNREADABLE],
      },
      // The mapping is read before the manifest: a broken one is reported even with no manifest.
      ...[null, '{ not json'].map((manifest) => ({
        ...grantCase({
          code: CALL,
          manifest,
          files: { [RUN_SERVICE_GRANTS_FILE]: 'export const RUN_SERVICE_GRANTS = { ...other };' },
        }),
        errors: [UNREADABLE],
      })),
      // A statement after the table (the freeze) leaves it readable.
      {
        ...grantCase({
          code: CALL,
          grants: [],
          files: {
            [RUN_SERVICE_GRANTS_FILE]: `export const RUN_SERVICE_GRANTS = { 'session-info': { list: 'session:read' } } as const;
deepFreeze(RUN_SERVICE_GRANTS);`,
          },
        }),
        errors: [LIST],
      },
      // Quoted and plain names and a table without `as const` are all read.
      {
        ...grantCase({
          code: CALL,
          grants: [],
          files: {
            [RUN_SERVICE_GRANTS_FILE]:
              "export const RUN_SERVICE_GRANTS = { 'session-info': { 'list': 'session:read' } };",
          },
        }),
        errors: [LIST],
      },
    ],
  },
);
