import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTION_APIS } from '../rules/prompt-apis.utils.js';
import { findInstructionApis } from '../testing/instruction-apis.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('the instruction-taking APIs harness/prompt-location checks', () => {
  const found = findInstructionApis(ROOT);

  it('list every exported function that takes an instructions option', () => {
    const unlisted = found.filter((name) => !OPTION_APIS.has(name));

    expect(
      unlisted,
      `${unlisted.join(', ')} take(s) instructions but is not in OPTION_APIS (packages/eslint-config/src/rules/prompt-apis.utils.js), so authored text passed to it goes unchecked: add it`,
    ).toEqual([]);
  });

  it('list no function that no longer takes one', () => {
    const stale = [...OPTION_APIS].filter((name) => !found.includes(name));

    expect(
      stale,
      `${stale.join(', ')} in OPTION_APIS no longer take(s) instructions: remove it`,
    ).toEqual([]);
  });
});

describe('findInstructionApis', () => {
  const workspace = (params) => {
    const { source, exports } = params;

    return tempWorkspace({
      'package.json': { name: 'root', workspaces: ['packages/*'] },
      'packages/demo/package.json': { name: '@sheavly/demo', exports },
      'packages/demo/src/run/run.helper.ts': source,
    });
  };

  it('finds a function by the type of its options, however it is declared', () => {
    const root = workspace({
      exports: { './*.helper': { '@sheavly/source': './src/*.helper.ts' } },
      source: `
        export interface RunOptions { instructions?: string }
        export function runDemo(options: RunOptions) {}
        export const startDemo = (options: Partial<RunOptions>) => {};
        export const inlineDemo = ({ baseInstructions }: { baseInstructions?: string }) => {};
        export function unrelated(options: { title: string }) {}
        function notExported(options: RunOptions) {}
      `,
    });

    expect(findInstructionApis(root)).toEqual(['inlineDemo', 'runDemo', 'startDemo']);
  });

  it('finds them in a checkout that sits in a folder called testing', () => {
    const outer = tempWorkspace({
      'testing/package.json': { name: 'root', workspaces: ['packages/*'] },
      'testing/packages/demo/package.json': {
        name: '@sheavly/demo',
        exports: { './*.helper': { '@sheavly/source': './src/*.helper.ts' } },
      },
      'testing/packages/demo/src/run/run.helper.ts':
        'export function runDemo(options: { instructions?: string }) {}',
    });

    expect(findInstructionApis(path.join(outer, 'testing'))).toEqual(['runDemo']);
  });

  it('ignores a module the package does not export', () => {
    const root = workspace({
      exports: { './*.helper': null },
      source: 'export function runDemo(options: { instructions?: string }) {}',
    });

    expect(findInstructionApis(root)).toEqual([]);
  });
});
