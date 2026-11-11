import { cpSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPromptFlow } from '../rules/prompt-flow.utils.js';
import { promptLocation } from '../rules/prompt-location.js';
import { promptSourceContext, promptSourceFile } from '../rules/prompt-source.utils.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const io = vi.hoisted(() => ({ reads: [], directories: [], virtualFiles: new Map() }));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal();

  return {
    ...fs,
    lstatSync: (file, ...options) => {
      if (io.virtualFiles.has(String(file))) {
        return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
      }

      return fs.lstatSync(file, ...options);
    },
    readFileSync: vi.fn((file, ...options) => {
      io.reads.push(String(file));

      if (io.virtualFiles.has(String(file))) return io.virtualFiles.get(String(file));

      return fs.readFileSync(file, ...options);
    }),
    readdirSync: vi.fn((directory, ...options) => {
      io.directories.push(String(directory));

      return fs.readdirSync(directory, ...options);
    }),
  };
});

const CURRENT = 'packages/app/src/tool/tool.tool.ts';
const SOURCE = 'packages/app/src/tool/text.constants.ts';
const HARNESS = "import { createHarness } from '@sheavly/host/host/host.helper';";
const TEXT = 'export const TEXT = "Harmless authored guidance";';
const roots = [];

function fixture(files = {}) {
  const root = tempWorkspace({
    'package.json': { workspaces: ['packages/*'] },
    'packages/app/package.json': {
      name: '@fixture/app',
      scripts: { schema: 'harmless-schema' },
      sheavly: { domain: 'generic' },
    },
    [CURRENT]: 'export const tool = 1;',
    [SOURCE]: TEXT,
    ...files,
  });

  roots.push(root);

  return root;
}

function instructions(specifier) {
  return `${HARNESS} import { TEXT } from '${specifier}'; createHarness({ instructions: TEXT });`;
}

function context(root, code = 'export const value = 1;', cwd = root) {
  const filename = path.join(root, CURRENT);
  const parsed = tseslint.parser.parseForESLint(code, {
    filePath: filename,
    range: true,
    loc: true,
    sourceType: 'module',
  });

  return { filename, cwd, sourceCode: parsed };
}

function lint(root, code) {
  return new Linter({ cwd: root }).verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { source: { rules: { location: promptLocation } } },
        rules: { 'source/location': 'error' },
      },
    ],
    path.join(root, CURRENT),
  );
}

function clearIO() {
  io.reads.length = 0;
  io.directories.length = 0;
  io.virtualFiles.clear();
}

function expectUntouched(...files) {
  for (const file of files) {
    expect(io.reads).not.toContain(file);
    expect(io.directories).not.toContain(file);
  }
}

function expectOutsideUntouched(outside) {
  expect([...io.reads, ...io.directories].some((file) => file.startsWith(outside))).toBe(false);
}

beforeEach(clearIO);

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('confined prompt source tracing', () => {
  it.each([
    instructions('./text.constants.js'),
    `${HARNESS} import * as text from './text.constants.js'; createHarness({ instructions: text.TEXT });`,
    instructions('@fixture/app/tool/text.constants'),
  ])('extracts authored text from supported in-root imports: %s', (code) => {
    const root = fixture();
    const problems = lint(root, code);

    expect(problems.map((problem) => problem.messageId)).toEqual(['extract']);
    expect(io.reads).toContain(path.join(root, SOURCE));
  });

  it('uses filename-first discovery for nonstandard patterns and independent copied roots', () => {
    const root = fixture({
      'package.json': { workspaces: ['modules/custom/*', 'explicit'] },
      'modules/custom/policy/package.json': { name: '@fixture/policy', sheavly: {} },
      'modules/custom/policy/src/text.constants.ts': TEXT,
      'explicit/package.json': { name: '@fixture/explicit', sheavly: { testOnly: true } },
      'explicit/src/data.constants.ts': TEXT,
    });
    const other = fixture();
    const copy = path.join(other, 'independent-copy');

    cpSync(root, copy, { recursive: true });

    for (const independent of [root, copy]) {
      clearIO();
      expect(lint(independent, instructions('@fixture/policy/text.constants'))[0].messageId).toBe(
        'extract',
      );
      expect(io.reads).toContain(
        path.join(independent, 'modules/custom/policy/src/text.constants.ts'),
      );
      expect(io.reads).not.toContain(path.join(other, SOURCE));
      const discovered = promptSourceContext(context(independent, undefined, other));

      expect(discovered.root).toBe(independent);
      expect(
        discovered.workspaces.find((workspace) => workspace.name === '@fixture/explicit'),
      ).toMatchObject({ testOnly: true, scripts: {} });
    }
  });

  it('falls back to context cwd and preserves scoped workspace metadata', () => {
    const root = fixture();
    const unowned = tempWorkspace({ 'entry.ts': 'export const value = 1;' });

    roots.push(unowned);
    const supplied = { ...context(root), filename: path.join(unowned, 'entry.ts') };
    const discovered = promptSourceContext(supplied);

    expect(discovered.root).toBe(root);
    expect(discovered.workspaces).toEqual([
      {
        name: '@fixture/app',
        dir: path.join(root, 'packages/app'),
        src: path.join(root, 'packages/app/src'),
        scripts: { schema: 'harmless-schema' },
        testOnly: false,
      },
    ]);
  });

  it.each(['ts', 'tsx', 'cts', 'mts', 'cjs', 'mjs', 'jsx'])(
    'loads supported .%s source',
    (extension) => {
      const file = `packages/app/src/tool/variant.${extension}`;
      const jsx = ['tsx', 'jsx'].includes(extension) ? 'const view = <span />;' : '';
      const root = fixture({ [file]: `${jsx} ${TEXT}` });

      expect(lint(root, instructions(`./variant.${extension}`))[0].messageId).toBe('extract');
      expect(io.reads).toContain(path.join(root, file));
    },
  );

  it('accepts supported .js names at the guard without changing shared .js-to-.ts resolution', () => {
    const root = fixture({ 'plain.js': TEXT });
    const file = path.join(root, 'plain.js');

    expect(promptSourceFile({ root, file })).toBe(file);
    expectUntouched(file);
    expect(lint(root, instructions('./text.constants.js'))[0].messageId).toBe('extract');
    expect(io.reads).toContain(path.join(root, SOURCE));
  });

  it('keeps extracted prompt imports opaque without reading their bodies', () => {
    const file = 'packages/app/src/tool/text.prompt.ts';
    const root = fixture({ [file]: 'Harmless invalid source ! ! !' });

    expect(lint(root, instructions('./text.prompt.js'))).toEqual([]);
    expectUntouched(path.join(root, file));
  });

  it.each(['txt', 'json', 'md'])(
    'keeps in-root and external .%s runtime data opaque',
    (extension) => {
      const root = fixture({
        [`packages/app/src/tool/data.${extension}`]: 'Harmless invalid syntax !',
      });
      const outside = fixture({
        [`data.${extension}`]: 'export const TEXT = "Not source guidance"; !',
      });
      const external = path.join(outside, `data.${extension}`);
      const relative = path.relative(path.dirname(path.join(root, CURRENT)), external);

      for (const specifier of [`./data.${extension}`, relative]) {
        expect(lint(root, instructions(specifier))).toEqual([]);
      }

      expectUntouched(path.join(root, `packages/app/src/tool/data.${extension}`), external);
      expectOutsideUntouched(outside);
    },
  );

  it('keeps env-prefixed path components opaque without creating or reading env fixtures', () => {
    const root = fixture();

    for (const name of [
      '.env',
      '.env.local.ts',
      '.env-folder/text.ts',
      'nested/.env-private/text.ts',
    ]) {
      const file = path.join(root, 'packages/app/src/tool', name);

      io.virtualFiles.set(file, TEXT);
      expect(promptSourceFile({ root, file })).toBeUndefined();
      expect(lint(root, instructions(`./${name}`))).toEqual([]);
      expectUntouched(file);
    }
  });

  it.each(['relative', 'workspace'])('rejects %s source traversal before external I/O', (kind) => {
    const root = fixture();
    const outside = fixture({ 'harmless.ts': 'Harmless external invalid source !' });
    const target = path.join(outside, 'harmless.ts');
    const from =
      kind === 'relative'
        ? path.dirname(path.join(root, CURRENT))
        : path.join(root, 'packages/app/src');
    const relative = path.relative(from, target);
    const specifier =
      kind === 'relative'
        ? relative.replace(/\.ts$/, '.js')
        : `@fixture/app/${relative.replace(/\.ts$/, '')}`;

    expect(() => lint(root, instructions(specifier))).toThrow(
      'Inventory path escapes workspace root',
    );
    expectOutsideUntouched(outside);
  });

  it.each([
    ['file', false],
    ['file', true],
    ['ancestor', false],
    ['ancestor', true],
  ])('rejects symlink %s with outside target=%s before source I/O', (kind, external) => {
    const root = fixture();
    const targetRoot = external ? fixture() : root;
    const target = path.join(targetRoot, kind === 'file' ? SOURCE : 'packages/app/src/tool');
    const link = path.join(root, `packages/app/src/tool/linked${kind === 'file' ? '.ts' : ''}`);

    symlinkSync(target, link);
    const specifier = kind === 'file' ? './linked.ts' : './linked/text.constants.js';

    expect(() => lint(root, instructions(specifier))).toThrow(
      'Symlinked inventory path is not allowed',
    );
    expectUntouched(link, target, path.join(target, 'text.constants.ts'));

    if (external) expectOutsideUntouched(targetRoot);
  });

  it('rechecks the source guard before returning a cached parsed module', () => {
    const root = fixture();
    const outside = fixture();
    const code = "import { TEXT } from './text.constants.js'; const value = TEXT;";
    const supplied = context(root, code);
    const flow = createPromptFlow(supplied);
    const value = flow.ref(supplied.sourceCode.ast.body[1].declarations[0].init);

    expect(flow.expand(value)[0].node.value).toBe('Harmless authored guidance');
    const file = path.join(root, SOURCE);
    const target = path.join(outside, SOURCE);

    rmSync(file);
    symlinkSync(target, file);
    clearIO();
    expect(() => flow.expand(value)).toThrow('Symlinked inventory path is not allowed');
    expectUntouched(file, target);
    expectOutsideUntouched(outside);
  });

  it('skips missing sources, supported-extension directories, and absent root/file inputs', () => {
    const root = fixture({ 'packages/app/src/tool/directory.ts/child.txt': 'Harmless data' });
    const directory = path.join(root, 'packages/app/src/tool/directory.ts');

    expect(lint(root, instructions('./directory.ts'))).toEqual([]);
    expect(lint(root, instructions('./missing.ts'))).toEqual([]);
    expect(promptSourceFile({ root, file: directory })).toBeUndefined();
    expect(promptSourceFile({ root, file: path.join(root, 'missing.ts') })).toBeUndefined();
    expect(promptSourceFile({ file: path.join(root, SOURCE) })).toBeUndefined();
    expect(promptSourceFile({ root })).toBeUndefined();
    expectUntouched(directory, path.join(root, SOURCE));
  });
});

describe('prompt flow metadata confinement', () => {
  it('rejects unsafe patterns during flow creation before traversing external metadata', () => {
    const root = fixture({ 'package.json': { workspaces: ['../outside/*'] } });

    expect(() => createPromptFlow(context(root))).toThrow('Unsafe inventory workspace pattern');
    expect(
      io.reads.every(
        (file) =>
          file === path.join(root, 'package.json') ||
          file === path.join(root, 'packages/app/package.json'),
      ),
    ).toBe(true);
    expect(io.directories).toEqual([]);
  });

  it.each(['linked/*', 'linked/nested/*'])(
    'rejects symlink pattern ancestry %s before external I/O',
    (pattern) => {
      const root = fixture({ 'package.json': { workspaces: [pattern] } });
      const outside = fixture();
      const link = path.join(root, 'linked');

      symlinkSync(outside, link);
      expect(() => createPromptFlow(context(root))).toThrow(link);
      expectUntouched(link);
      expectOutsideUntouched(outside);
    },
  );

  it.each(['package.json', 'packages/app/package.json'])(
    'rejects linked manifest %s before reading its contents',
    (manifest) => {
      const root = fixture();
      const outside = fixture({ 'harmless.json': '{"HARMLESS_EXTERNAL_SENTINEL": broken}' });
      const file = path.join(root, manifest);
      const target = path.join(outside, 'harmless.json');

      rmSync(file);
      symlinkSync(target, file);
      expect(() => createPromptFlow(context(root))).toThrow(
        'Symlinked inventory path is not allowed',
      );
      expectUntouched(file, target);
      expectOutsideUntouched(outside);
    },
  );

  it('does not scan or parse unrelated types files when creating a flow or linting without a project', () => {
    const file = 'packages/app/src/unrelated.types.ts';
    const root = fixture({ [file]: 'Harmless malformed type source ! ! !' });
    const flow = createPromptFlow(context(root));

    expect(flow.workspaces[0].name).toBe('@fixture/app');
    expect(lint(root, instructions('./text.constants.js'))[0].messageId).toBe('extract');
    expectUntouched(path.join(root, file));
    expect(io.directories).not.toContain(path.join(root, 'packages/app/src'));
  });

  it('keeps direct rule invocation consistent for a test-only owning workspace', () => {
    const root = fixture({
      'packages/app/package.json': { name: '@fixture/app', sheavly: { testOnly: true } },
    });

    expect(
      lint(root, `${HARNESS} createHarness({ instructions: 'Harmless fixture text' });`),
    ).toEqual([]);
    expectUntouched(path.join(root, SOURCE));
  });
});
