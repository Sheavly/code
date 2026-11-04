import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { TrustStore } from '../../trust/trust.service.js';
import { memoryTrust } from '../../testing/trust.fake.js';
import { loadProjectHooks } from '../project-hooks.helper.js';
import { ProjectHooksError } from '../../errors/project-hooks.errors.js';

const ESM = (name: string) =>
  `export default { name: '${name}', beforeTurn: async ({ addContext }) => addContext('${name}') };\n`;
const CJS = (name: string) =>
  `module.exports = { name: '${name}', beforeTurn: async ({ addContext }) => addContext('${name}') };\n`;
const TS_ESM = (name: string) =>
  `import type { Hook } from '@sheavly/core/hook/hook.types';\n` +
  `type Note = string;\nconst note: Note = '${name}';\n` +
  `const hook: Hook = { name: '${name}', beforeTurn: async ({ addContext }) => addContext(note) };\n` +
  `export default hook;\n`;
const TS_CJS = (name: string) =>
  `const note: string = '${name}';\n` +
  `module.exports = { name: '${name}', beforeTurn: async ({ addContext }: { addContext: (c: string) => void }) => addContext(note) };\n`;

let roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .flatMap((root) => [root, `${root}.trusted.json`])
      .map((file) => rm(file, { recursive: true, force: true })),
  );
  roots = [];
});

/** A temp project: package.json (`type` omitted when undefined), and `.sheavly/` files. */
async function project(params: {
  type?: 'module' | 'commonjs';
  manifest?: unknown;
  files?: Record<string, string>;
}): Promise<string> {
  const { type, manifest, files = {} } = params;
  const root = await mkdtemp(path.join(tmpdir(), 'sheavly-hooks-'));

  roots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify(type ? { type } : {}));
  await mkdir(path.join(root, '.sheavly', 'hooks'), { recursive: true });

  if (manifest !== undefined) {
    const text = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);

    await writeFile(path.join(root, '.sheavly', 'hooks.json'), text);
  }

  for (const [file, contents] of Object.entries(files)) {
    await writeFile(path.join(root, '.sheavly', file), contents);
  }

  return root;
}

const manifestOf = (...paths: string[]) => ({ version: 1, hooks: paths.map((p) => ({ path: p })) });

/** The context each hook adds, in order: proves the files ran, not just loaded. */
async function contextFrom(hooks: Hook[]): Promise<string[]> {
  const added: string[] = [];

  for (const hook of hooks) {
    await hook.beforeTurn?.({
      turn: 1,
      messages: [],
      signal: new AbortController().signal,
      addContext: (content) => added.push(content),
      addInstructions: () => undefined,
    });
  }

  return added;
}

/**
 * Loads `root`'s hooks as a host does after the user trusted it (`grant`), with a trust store of
 * its own in the temp project, so these tests are about loading, not trust.
 */
async function loadTrusted(root: string): Promise<Hook[]> {
  return (await loadProjectHooks({ root, trust: trustStoreIn(root), grant: true })).hooks;
}

/** A trust store beside the temp project, never inside it (a repo can't hold its own trust). */
const trustStoreIn = (root: string) =>
  new TrustStore({ persistence: memoryTrust({ file: `${root}.trusted.json` }) });

async function loadError(root: string): Promise<string> {
  const failure: unknown = await loadTrusted(root).catch((caughtError: unknown) => caughtError);

  expect(failure).toBeInstanceOf(ProjectHooksError);

  return (failure as Error).message;
}

describe('loadProjectHooks', () => {
  it('returns no hooks when there is no .sheavly/hooks.json', async () => {
    const root = await project({});

    expect(await loadProjectHooks({ root, trust: trustStoreIn(root) })).toEqual({
      hooks: [],
      trust: 'no_hooks',
    });
  });

  it.each([
    ['module', 'esm.js', ESM],
    ['commonjs', 'cjs.js', CJS],
    ['module', 'esm.ts', TS_ESM],
    ['commonjs', 'cjs.ts', TS_CJS],
  ] as const)(
    'plain extensions follow package.json "type": %s project loads %s',
    async (type, file, source) => {
      const root = await project({
        type,
        manifest: manifestOf(`hooks/${file}`),
        files: { [`hooks/${file}`]: source(file) },
      });

      expect(await contextFrom(await loadTrusted(root))).toEqual([file]);
    },
  );

  it('explicit extensions load in any project: .mjs .cjs .mts .cts', async () => {
    for (const type of ['module', 'commonjs'] as const) {
      const root = await project({
        type,
        manifest: manifestOf('hooks/a.mjs', 'hooks/b.cjs', 'hooks/c.mts', 'hooks/d.cts'),
        files: {
          'hooks/a.mjs': ESM('a'),
          'hooks/b.cjs': CJS('b'),
          'hooks/c.mts': TS_ESM('c'),
          'hooks/d.cts': TS_CJS('d'),
        },
      });

      expect(await contextFrom(await loadTrusted(root))).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('keeps manifest order and skips disabled hooks', async () => {
    const root = await project({
      type: 'module',
      manifest: {
        version: 1,
        hooks: [
          { path: 'hooks/second.js' },
          { path: 'hooks/off.js', enabled: false },
          { path: 'hooks/first.js' },
        ],
      },
      files: {
        'hooks/first.js': ESM('first'),
        'hooks/second.js': ESM('second'),
        'hooks/off.js': 'throw new Error("must not load");\n',
      },
    });

    expect(await contextFrom(await loadTrusted(root))).toEqual(['second', 'first']);
  });

  it('tells you to rename a CommonJS .js hook in an ESM project to .cjs', async () => {
    const root = await project({
      type: 'module',
      manifest: manifestOf('hooks/old.js'),
      files: { 'hooks/old.js': CJS('old') },
    });

    expect(await loadError(root)).toMatch(
      /\.sheavly\/hooks\/old\.js failed to load[\s\S]*Rename it to \.cjs/,
    );
  });

  it('tells you to rename an ESM .ts hook in a CommonJS project to .mts', async () => {
    const root = await project({
      type: 'commonjs',
      manifest: manifestOf('hooks/new.ts'),
      files: { 'hooks/new.ts': TS_ESM('new') },
    });

    expect(await loadError(root)).toMatch(/Rename it to \.mts/);
  });

  it('explains TypeScript syntax Node cannot strip', async () => {
    const root = await project({
      type: 'module',
      manifest: manifestOf('hooks/enum.ts'),
      files: {
        'hooks/enum.ts': `enum Mode { A }\nexport default { name: 'x', beforeTurn: async () => { void Mode.A; } };\n`,
      },
    });

    expect(await loadError(root)).toMatch(/only erasable syntax works/);
  });

  it('rejects an invalid manifest, naming the problem', async () => {
    const unknownKey = await project({
      manifest: { version: 1, hooks: [{ path: 'hooks/a.js', when: 'x' }] },
    });
    const badExtension = await project({ manifest: manifestOf('hooks/a.py') });
    const notJson = await project({ manifest: '{ version: 1' });

    expect(await loadError(unknownKey)).toMatch(/Invalid \.sheavly\/hooks\.json[\s\S]*when/);
    expect(await loadError(badExtension)).toMatch(/must end in one of/);
    expect(await loadError(notJson)).toMatch(/not valid JSON/);
  });

  it('rejects a hook file that is missing, outside .sheavly, or not a hook', async () => {
    const missing = await project({ manifest: manifestOf('hooks/nope.js') });
    const escape = await project({ manifest: manifestOf('../package.js') });
    const noDefault = await project({
      type: 'module',
      manifest: manifestOf('hooks/named.js'),
      files: { 'hooks/named.js': ESM('named').replace('export default', 'export const hook =') },
    });
    const noHandler = await project({
      type: 'module',
      manifest: manifestOf('hooks/empty.js'),
      files: { 'hooks/empty.js': "export default { name: 'empty' };\n" },
    });

    expect(await loadError(missing)).toMatch(/hooks\/nope\.js: file not found/);
    expect(await loadError(escape)).toMatch(/outside the workspace/);
    expect(await loadError(noDefault)).toMatch(/must export its hook as the default/);
    expect(await loadError(noHandler)).toMatch(/at least one handler/);
  });

  it('rejects a symlink that points out of .sheavly', async () => {
    const root = await project({ type: 'module', manifest: manifestOf('hooks/link.js') });

    await writeFile(path.join(root, 'outside.js'), ESM('outside'));
    await symlink(path.join(root, 'outside.js'), path.join(root, '.sheavly', 'hooks', 'link.js'));

    expect(await loadError(root)).toMatch(/outside the workspace/);
  });

  it('accepts every handler from a file: sessionStart, afterTurn, onError', async () => {
    const root = await project({
      type: 'module',
      manifest: manifestOf('hooks/lifecycle.js'),
      files: {
        'hooks/lifecycle.js':
          "export default { name: 'lifecycle', sessionStart: async () => {}, afterTurn: async () => {}, onError: async () => {} };\n",
      },
    });
    const [hook] = await loadTrusted(root);

    expect(Object.keys(hook ?? {}).sort()).toEqual([
      'afterTurn',
      'name',
      'onError',
      'sessionStart',
    ]);
  });

  it('rejects two hooks with the same name', async () => {
    const root = await project({
      type: 'module',
      manifest: manifestOf('hooks/a.js', 'hooks/b.js'),
      files: { 'hooks/a.js': ESM('same'), 'hooks/b.js': ESM('same') },
    });

    expect(await loadError(root)).toMatch(/already named "same"/);
  });
});

describe('project hooks in the loop', () => {
  it('runs inside the passed-in hooks: host hooks are outermost', async () => {
    const order: string[] = [];
    const root = await project({
      type: 'module',
      manifest: manifestOf('hooks/project.js'),
      files: {
        'hooks/project.js':
          "export default { name: 'project', aroundToolCall: async ({ next }) => {" +
          " globalThis.sheavlyOrder.push('project in'); const result = await next();" +
          " globalThis.sheavlyOrder.push('project out'); return result; } };\n",
      },
    });
    const host = defineHook({
      name: 'host',
      aroundToolCall: async ({ next }) => {
        order.push('host in');
        const result = await next();

        order.push('host out');

        return result;
      },
    });
    const ping = defineTool({
      name: 'ping',
      description: 'Replies pong',
      inputSchema: z.object({}),
      execute: async () => (order.push('tool'), 'pong'),
    });

    Object.assign(globalThis, { sheavlyOrder: order });

    const messages = await runAgent({
      provider: scriptedProvider([
        [toolCall({ id: '1', name: 'ping', input: {} }), { type: 'done', stopReason: 'tool_use' }],
        [{ type: 'done', stopReason: 'end_turn' }],
      ]),
      tools: [ping],
      messages: [{ role: 'user', content: 'ping' }],
      hooks: [host, ...(await loadTrusted(root))],
    });

    expect(order).toEqual(['host in', 'project in', 'tool', 'project out', 'host out']);
    expect(messages[2]).toMatchObject({ role: 'tool', content: 'pong', isError: false });
  });
});
