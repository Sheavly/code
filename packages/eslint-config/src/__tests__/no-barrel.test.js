import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

// A re-export is a barrel, except a types file naming the types it exposes as its public API:
// that creates no second definition. Values, wildcards, the inline `type` modifier and every
// other file kind stay rejected.
const ruleTester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const TYPES = 'src/run-services/run-services.types.ts';
const reports = (code, filename) => ({ code, filename, errors: [{ messageId: 'barrel' }] });

ruleTester.run('no-barrel', harnessPlugin.rules['no-barrel'], {
  valid: [
    // Own exports and plain imports are not re-exports.
    { code: 'export type A = string;', filename: TYPES },
    { code: "import type { A } from './a.types.js'; export type B = A;", filename: TYPES },
    { code: 'export const x = 1;', filename: 'src/a/a.utils.ts' },
    // A type-only named re-export in a types file: one specifier, several, and a rename.
    { code: "export type { A } from '@x/y/a.types';", filename: TYPES },
    { code: "export type { A, B, C } from '@x/y/a.types';", filename: TYPES },
    { code: "export type { A, B as C } from '@x/y/a.types';", filename: TYPES },
  ],
  invalid: [
    // A value re-export, a wildcard and a namespace re-export, in a types file or not.
    reports("export { x } from './x.utils.js';", TYPES),
    reports("export { x as y } from './x.utils.js';", 'src/a/a.utils.ts'),
    reports("export * from './a.types.js';", TYPES),
    reports("export * as ns from './a.types.js';", TYPES),
    reports("export * from './a.utils.js';", 'src/a/index.ts'),
    // A wildcard type re-export hides what is re-exported.
    reports("export type * from './a.types.js';", TYPES),
    // The inline modifier makes a value re-export statement.
    reports("export { type A } from './a.types.js';", TYPES),
    reports("export { type A, b } from './a.types.js';", TYPES),
    // A type re-export outside a types file.
    reports("export type { A } from './a.types.js';", 'src/a/a.utils.ts'),
    reports("export type { A } from './a.types.js';", 'src/a/a.helper.ts'),
    reports("export type { A } from './a.types.js';", 'src/a/index.ts'),
    reports("export type { A } from './a.types.js';", 'src/a/__tests__/a.test.ts'),
  ],
});
