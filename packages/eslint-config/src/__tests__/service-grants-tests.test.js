import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  helperSpecifier,
  helperUse,
  serviceGrantTestProblems,
} from '../service-grants-tests.utils.js';
import { listWorkspaces } from '../layout.utils.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SPECIFIER = '@sheavly/kit/testing/service-grants.fake';
const CALLING = `import { assertServiceEnforcesGrants } from '${SPECIFIER}';\n\nawait assertServiceEnforcesGrants({ provider, service, calls });\n`;
const MANIFEST = { name: 'notes', services: { provides: ['store'], grants: { store: ['s:w'] } } };

/** A monorepo with the kit holding the helper and an extension `notes` with the given files. */
function repo(files = {}) {
  return tempWorkspace({
    'package.json': { name: 'monorepo', workspaces: ['packages/*', 'extensions/*'] },
    'packages/kit/package.json': {
      name: '@sheavly/kit',
      exports: { './testing/*': { '@sheavly/source': './src/testing/*.ts' } },
    },
    'packages/kit/src/testing/service-grants.fake.ts': 'export {};\n',
    'extensions/notes/package.json': { name: '@sheavly/notes' },
    'extensions/notes/sheavly.json': MANIFEST,
    ...files,
  });
}

const TEST = 'extensions/notes/src/notes/__tests__/notes-grants.test.ts';
/** A second workspace that also holds the helper file behind a `./testing/*` export. */
const SECOND_HOLDER = {
  'packages/other/package.json': {
    name: '@sheavly/other',
    exports: { './testing/*': { '@sheavly/source': './src/testing/*.ts' } },
  },
  'packages/other/src/testing/service-grants.fake.ts': 'export {};\n',
};

describe('an extension that declares service grants proves them with the shared helper', () => {
  it('accepts the real tree', () => {
    expect(serviceGrantTestProblems({ root: REPO_ROOT })).toEqual([]);
    expect(helperSpecifier(listWorkspaces(REPO_ROOT))).toBe(
      '@sheavly/extension/testing/service-grants.fake',
    );
  });

  it('accepts a workspace with a test that imports and calls the helper', () => {
    expect(serviceGrantTestProblems({ root: repo({ [TEST]: CALLING }) })).toEqual([]);
  });

  it('accepts an aliased import that is called', () => {
    const text = `import { assertServiceEnforcesGrants as prove } from '${SPECIFIER}';\n\nawait prove({});\n`;

    expect(serviceGrantTestProblems({ root: repo({ [TEST]: text }) })).toEqual([]);
  });

  it('accepts a namespace import whose helper member is called', () => {
    const text = `import * as kit from '${SPECIFIER}';\n\nawait kit.assertServiceEnforcesGrants({});\n`;

    expect(serviceGrantTestProblems({ root: repo({ [TEST]: text }) })).toEqual([]);
  });

  it('accepts two imports of the specifier in one file', () => {
    const text = `import { other } from '${SPECIFIER}';\nimport { assertServiceEnforcesGrants } from '${SPECIFIER}';\n\nawait assertServiceEnforcesGrants({});\n`;

    expect(serviceGrantTestProblems({ root: repo({ [TEST]: text }) })).toEqual([]);
  });

  it('accepts a default plus namespace clause and a multi-line named import', () => {
    const mixed = `import def, * as kit from '${SPECIFIER}';\n\nkit.assertServiceEnforcesGrants({});\n`;
    const multi = `import {\n  other,\n  assertServiceEnforcesGrants as prove,\n} from '${SPECIFIER}';\n\nprove({});\n`;

    expect(helperUse({ text: mixed, specifier: SPECIFIER }).called).toBe(true);
    expect(helperUse({ text: multi, specifier: SPECIFIER }).called).toBe(true);
  });

  it('rejects a namespace import whose call is only in a comment or on another member', () => {
    const comment = `import * as kit from '${SPECIFIER}';\n\n// kit.assertServiceEnforcesGrants({});\n`;
    const member = `import * as kit from '${SPECIFIER}';\n\nkit.other({});\n`;

    expect(helperUse({ text: comment, specifier: SPECIFIER })).toEqual({
      imported: true,
      called: false,
    });
    expect(helperUse({ text: member, specifier: SPECIFIER }).called).toBe(false);
  });

  it('does not count a type-only import or a re-export as an import', () => {
    const typed = `import type { assertServiceEnforcesGrants } from '${SPECIFIER}';\n`;
    const reexport = `export { assertServiceEnforcesGrants } from '${SPECIFIER}';\n`;

    expect(helperUse({ text: typed, specifier: SPECIFIER }).imported).toBe(false);
    expect(helperUse({ text: reexport, specifier: SPECIFIER }).imported).toBe(false);
  });

  it('rejects a workspace with service grants and no test', () => {
    const [problem, ...rest] = serviceGrantTestProblems({ root: repo() });

    expect(rest).toEqual([]);
    expect(problem).toContain('@sheavly/notes provides store with services.grants');
    expect(problem).toContain(`from '${SPECIFIER}'`);
  });

  it('rejects a test that imports the helper and never calls it', () => {
    const text = `import { assertServiceEnforcesGrants } from '${SPECIFIER}';\n\n// assertServiceEnforcesGrants({});\nexport const unused = assertServiceEnforcesGrants;\n`;
    const [problem] = serviceGrantTestProblems({ root: repo({ [TEST]: text }) });

    expect(problem).toContain('imports assertServiceEnforcesGrants but none calls it');
  });

  it('rejects a test that calls a function of that name from elsewhere', () => {
    const text = `import { assertServiceEnforcesGrants } from './own.js';\n\nawait assertServiceEnforcesGrants({});\n`;

    expect(serviceGrantTestProblems({ root: repo({ [TEST]: text }) })).toHaveLength(1);
  });

  it('rejects a file that is not a test in a __tests__ folder', () => {
    const files = {
      'extensions/notes/src/notes/notes.helper.ts': CALLING,
      'extensions/notes/src/notes/notes.test.ts': CALLING,
    };

    expect(serviceGrantTestProblems({ root: repo(files) })).toHaveLength(1);
  });

  it('asks for nothing from an extension that declares no service grants', () => {
    const plain = { 'extensions/notes/sheavly.json': { name: 'notes', grants: ['a:b'] } };
    const empty = {
      'extensions/notes/sheavly.json': { name: 'notes', services: { grants: { store: [] } } },
    };

    expect(serviceGrantTestProblems({ root: repo(plain) })).toEqual([]);
    expect(serviceGrantTestProblems({ root: repo(empty) })).toEqual([]);
  });

  it('asks for nothing from a package, only from an extension', () => {
    const files = { 'packages/kit/sheavly.json': MANIFEST };

    expect(serviceGrantTestProblems({ root: repo(files) })).toHaveLength(1);
    expect(
      serviceGrantTestProblems({
        root: repo({ 'extensions/notes/sheavly.json': { name: 'notes' }, ...files }),
      }),
    ).toEqual([]);
  });

  it('reports a repo with no helper to prove the grants with', () => {
    const root = tempWorkspace({
      'package.json': { name: 'monorepo', workspaces: ['extensions/*'] },
      'extensions/notes/package.json': { name: '@sheavly/notes' },
      'extensions/notes/sheavly.json': MANIFEST,
    });

    expect(serviceGrantTestProblems({ root })[0]).toContain('no workspace has');
  });

  it('reports one problem when two workspaces hold the helper, instead of picking the first', () => {
    const root = repo({ [TEST]: CALLING, ...SECOND_HOLDER });
    const problems = serviceGrantTestProblems({ root });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('@sheavly/kit, @sheavly/other');
    expect(problems[0]).toContain('ambiguous');
    expect(helperSpecifier(listWorkspaces(root))).toBeNull();
  });

  it('asks nothing of a repo with two holders when no extension declares service grants', () => {
    const files = { 'extensions/notes/sheavly.json': { name: 'notes' }, ...SECOND_HOLDER };

    expect(serviceGrantTestProblems({ root: repo(files) })).toEqual([]);
  });

  it('keeps the limits docs/rules.md lists: a same-file method and a typeof instantiation count, a bracket call does not', () => {
    const head = `import { assertServiceEnforcesGrants } from '${SPECIFIER}';\n\n`;
    const method = `${head}const own = { assertServiceEnforcesGrants() {} };\n`;
    const typeofUse = `${head}type Proved = typeof assertServiceEnforcesGrants<Provider>;\n`;
    const bracket = `import * as kit from '${SPECIFIER}';\n\nawait kit['assertServiceEnforcesGrants']({});\n`;

    expect(helperUse({ text: method, specifier: SPECIFIER }).called).toBe(true);
    expect(helperUse({ text: typeofUse, specifier: SPECIFIER }).called).toBe(true);
    expect(helperUse({ text: bracket, specifier: SPECIFIER }).called).toBe(false);
  });

  it('reads the import and the call from the text', () => {
    expect(helperUse({ text: CALLING, specifier: SPECIFIER })).toEqual({
      imported: true,
      called: true,
    });
    expect(helperUse({ text: 'export {};\n', specifier: SPECIFIER })).toEqual({
      imported: false,
      called: false,
    });
  });
});
