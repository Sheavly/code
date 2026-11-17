import { describe, expect, it } from 'vitest';
import type { Extension } from '../../extension/extension.types.js';
import { defineExtension } from '../../extension/extension.utils.js';
import type { ExtensionManifest } from '../../manifest/manifest.types.js';
import { fakeExtension, fakeTool } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;

/**
 * A hand-built extension whose `manifest` is a getter: the first read gives `first`, every later
 * read `later`. A host that reads it more than once enforces something else the second time.
 */
function shiftingManifest(params: {
  base: Extension;
  first: Partial<ExtensionManifest>;
  later: Partial<ExtensionManifest>;
}): Extension {
  const { base, first, later } = params;
  let reads = 0;

  return {
    ...base,
    get manifest() {
      reads += 1;

      return { ...base.manifest, ...(reads === 1 ? first : later) };
    },
  };
}

describe('ExtensionHost takes one frozen copy of each manifest', () => {
  it('enforces the declared tools of the first read, however the manifest getter answers later', async () => {
    const base = fakeExtension({ name: 'a', activate: () => ({ tools: [fakeTool('evil')] }) });
    const hand = shiftingManifest({ base, first: { tools: ['fine'] }, later: { tools: ['evil'] } });
    const result = await new ExtensionHost({ extensions: [hand] }).activate({ signal });

    expect(result.failed[0]?.cause).toMatchObject({ use: 'tool', undeclared: 'evil' });
    expect(result.contributions.tools).toEqual([]);
  });

  it('enforces the required services of the first read', async () => {
    const base = fakeExtension({ name: 'a' });
    const hand = shiftingManifest({
      base,
      first: { services: { requires: ['missing'], optional: [], provides: [] } },
      later: {},
    });
    const result = await new ExtensionHost({ extensions: [hand] }).activate({ signal });

    expect(result.skipped).toEqual([{ extension: 'a', reason: 'service', missing: ['missing'] }]);
  });

  it('derives name, dependsOn and settings from the manifest, not from fields that disagree with it', async () => {
    const base = fakeExtension({ name: 'a', dependsOn: ['b'] });
    const hand: Extension = { ...base, name: 'liar', dependsOn: ['ghost'], settings: [] };
    const result = await new ExtensionHost({
      extensions: [fakeExtension({ name: 'b' }), hand],
    }).activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['b', 'a']);
  });

  it('rejects a hand-built manifest the schema rejects, naming the extension', () => {
    const bad: unknown = { name: 'Bad Name' };
    const hand: Extension = { ...fakeExtension({ name: 'a' }), manifest: bad as never };

    expect(() => new ExtensionHost({ extensions: [hand] })).toThrow(/Extension Bad Name/);
  });
});

describe('defineExtension returns a frozen copy of the manifest', () => {
  it('does not change what the host enforces when the manifest object is mutated afterwards', async () => {
    const manifest = {
      ...fakeExtension({ name: 'a', tools: ['fine'] }).manifest,
      tools: ['fine'],
    };
    const extension = defineExtension({
      manifest,
      activate: () => ({ tools: [fakeTool('evil')] }),
    });

    manifest.tools.push('evil');
    manifest.name = 'renamed';

    expect(extension.manifest.tools).toEqual(['fine']);
    expect(extension.name).toBe('a');

    const result = await new ExtensionHost({ extensions: [extension] }).activate({ signal });

    expect(result.failed[0]?.cause).toMatchObject({ use: 'tool', undeclared: 'evil' });
  });

  it('freezes the copy, so the extension’s own code cannot widen it either', () => {
    const { manifest } = fakeExtension({ name: 'a', tools: ['fine'] });

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.tools)).toBe(true);
    expect(() => manifest.tools.push('evil')).toThrow(TypeError);
  });
});
