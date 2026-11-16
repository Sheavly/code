import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrustStore } from '../../trust/trust.service.js';
import { memoryTrust } from '../../testing/trust.fake.js';
import { loadProjectHooks } from '../project-hooks.helper.js';

// A hook whose file, when imported at all, leaves a mark: proves an untrusted workspace's hook
// code never runs, not just that its hooks aren't returned.
const MARKING_HOOK = (mark: string) =>
  `import { writeFileSync } from 'node:fs';\n` +
  `writeFileSync(${JSON.stringify(mark)}, 'imported');\n` +
  `export default { name: 'marker', beforeTurn: async () => {} };\n`;

let base = '';
let root = '';
let mark = '';
let trust: TrustStore;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'project-trust-'));
  root = path.join(base, 'project');
  mark = path.join(base, 'imported.txt');
  trust = new TrustStore({ persistence: memoryTrust({ file: path.join(base, 'trusted.json') }) });

  await mkdir(path.join(root, '.sheavly', 'hooks'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(root, '.sheavly', 'hooks.json'),
    JSON.stringify({ version: 1, hooks: [{ path: 'hooks/marker.js' }] }),
  );
  await writeFile(path.join(root, '.sheavly', 'hooks', 'marker.js'), MARKING_HOOK(mark));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const imported = () =>
  readFile(mark, 'utf8').then(
    () => true,
    (caughtError: unknown) => {
      if ((caughtError as { code?: string }).code === 'ENOENT') return false;
      throw caughtError;
    },
  );

describe('loadProjectHooks and workspace trust', () => {
  it('loads nothing from an untrusted workspace, and imports none of its files', async () => {
    expect(await loadProjectHooks({ root, trust })).toEqual({ hooks: [], trust: 'untrusted' });
    expect(await imported()).toBe(false);
  });

  it('loads the hooks once the workspace is granted, and remembers it next time', async () => {
    const granted = await loadProjectHooks({ root, trust, grant: true });

    expect(granted.trust).toBe('trusted');
    expect(granted.hooks.map((hook) => hook.name)).toEqual(['marker']);
    expect(await imported()).toBe(true);
    expect((await loadProjectHooks({ root, trust })).trust).toBe('trusted');
  });

  it('loads nothing once .sheavly/ changed since it was trusted, until trusted again', async () => {
    await trust.trust({ root });
    await rm(mark, { force: true });
    await writeFile(
      path.join(root, '.sheavly', 'hooks', 'marker.js'),
      `${MARKING_HOOK(mark)}// new code\n`,
    );

    expect(await loadProjectHooks({ root, trust })).toEqual({ hooks: [], trust: 'changed' });
    expect(await imported()).toBe(false);
    expect((await loadProjectHooks({ root, trust, grant: true })).trust).toBe('trusted');
  });

  it('stops when .sheavly/ changes between the trust check and the import, importing nothing', async () => {
    await trust.trust({ root });

    const check = trust.check.bind(trust);
    let checks = 0;

    vi.spyOn(trust, 'check').mockImplementation(async (params) => {
      const state = await check(params);

      checks += 1;

      // The first check passes; the file is edited right after it, before the import.
      if (checks === 1) {
        await writeFile(
          path.join(root, '.sheavly', 'hooks', 'marker.js'),
          `${MARKING_HOOK(mark)}// swapped in\n`,
        );
      }

      return state;
    });

    await expect(loadProjectHooks({ root, trust })).rejects.toThrow(
      'changed after the trust check',
    );
    expect(await imported()).toBe(false);
  });

  it('does not report trusted when .sheavly/ changes while the last hook is imported', async () => {
    const touched = path.join(root, '.sheavly', 'touched.txt');

    await writeFile(
      path.join(root, '.sheavly', 'hooks', 'marker.js'),
      `import { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(touched)}, 'edited during import');\n` +
        `export default { name: 'marker', beforeTurn: async () => {} };\n`,
    );

    await expect(loadProjectHooks({ root, trust, grant: true })).rejects.toThrow(
      'changed after the trust check, so the hooks were not used',
    );
  });

  it('skips a broken manifest in an untrusted workspace instead of stopping startup', async () => {
    await writeFile(path.join(root, '.sheavly', 'hooks.json'), '{ not json');

    expect(await loadProjectHooks({ root, trust })).toEqual({ hooks: [], trust: 'untrusted' });
  });

  it('does not read the manifest of an untrusted workspace: one that is a folder is skipped', async () => {
    await rm(path.join(root, '.sheavly', 'hooks.json'));
    await mkdir(path.join(root, '.sheavly', 'hooks.json'));

    expect(await loadProjectHooks({ root, trust })).toEqual({ hooks: [], trust: 'untrusted' });
  });

  it('never trusts a workspace without hooks (nothing to trust)', async () => {
    await rm(path.join(root, '.sheavly'), { recursive: true });

    expect(await loadProjectHooks({ root, trust, grant: true })).toEqual({
      hooks: [],
      trust: 'no_hooks',
    });
    expect(await trust.check({ root })).toBe('untrusted');
  });
});

describe('imports from a trusted hook', () => {
  /** Makes `.sheavly/hooks/marker.js` the given source, trusts the workspace and loads it. */
  async function load(source: string) {
    await writeFile(path.join(root, '.sheavly', 'hooks', 'marker.js'), source);

    return loadProjectHooks({ root, trust, grant: true });
  }

  const HOOK = `export default { name: 'marker', beforeTurn: async () => {} };\n`;

  it('may import files inside .sheavly/ and Node built-ins', async () => {
    await writeFile(path.join(root, '.sheavly', 'hooks', 'helper.js'), 'export const x = 1;\n');

    const loaded = await load(
      `import { x } from './helper.js';\nimport path from 'node:path';\nvoid x, path;\n${HOOK}`,
    );

    expect(loaded.hooks.map((hook) => hook.name)).toEqual(['marker']);
  });

  it.each([
    ['a file outside .sheavly/', `import '../../outside.js';\n`],
    ['a package', `import 'zod';\n`],
    ['a symlink that leaves .sheavly/', `import './out-link.js';\n`],
    [
      'a CommonJS require of a file outside',
      `import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('../../outside.cjs');\n`,
    ],
  ])('refuses %s, before its code runs', async (_what, imports) => {
    await writeFile(path.join(root, 'outside.js'), MARKING_HOOK(mark));
    await writeFile(
      path.join(root, 'outside.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(mark)}, 'x');\n`,
    );
    await symlink(
      path.join(root, 'outside.js'),
      path.join(root, '.sheavly', 'hooks', 'out-link.js'),
    );

    await expect(load(`${imports}${HOOK}`)).rejects.toThrow(
      'may only import Node built-ins and files inside .sheavly/',
    );
    expect(await imported()).toBe(false);
  });
});
