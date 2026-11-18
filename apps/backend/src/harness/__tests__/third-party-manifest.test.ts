/**
 * What a third party's `sheavly.json` does on the backend run: it is read from a file, it holds
 * the extension to what it declares, a missing required service skips it, and a wildcard lets it
 * contribute names it only knows at run time. Public exports only, like the capabilities test.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { SESSION_INFO } from '@sheavly/host/run-services/run-services.utils';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { manifestOf } from '../../testing/manifest.fake.js';

const open = useBackendRuns();

const stamp = defineTool({
  name: 'stamp',
  description: 'Stamps a note',
  inputSchema: z.object({}),
  execute: async () => 'STAMPED',
});

/** A hook with the given name that adds nothing. */
const hookNamed = (name: string) => defineHook({ name, sessionStart: async () => undefined });

describe('a third-party extension’s manifest on the backend run', () => {
  it('loads its manifest from a sheavly.json file and activates through createBackendHarness', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'third-party-manifest-'));

    try {
      const file = path.join(folder, 'sheavly.json');

      await writeFile(
        file,
        JSON.stringify({
          name: 'stamper',
          services: { requires: ['session-info'] },
          tools: ['stamp'],
          hooks: ['stamper-hint'],
        }),
      );

      const stamper = defineExtension({
        manifest: readManifest(file),
        activate: ({ services }) => {
          services.get(SESSION_INFO);

          return { tools: [stamp], hooks: [hookNamed('stamper-hint')] };
        },
      });
      const harness = await open({ extensions: [stamper] });

      expect(harness.tools.map((tool) => tool.name)).toContain('stamp');
      expect(harness.hooks.map((hook) => hook.name)).toContain('stamper-hint');
      expect(harness.skippedExtensions).toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('fails an extension that reads a service its manifest does not declare, naming it', async () => {
    const nosy = defineExtension({
      manifest: manifestOf({ name: 'nosy' }),
      activate: ({ services }) => {
        services.get(SESSION_INFO);

        return {};
      },
    });

    // The backend stops the run on any activation failure, with that failure's own error.
    const failure: unknown = await open({ extensions: [nosy] }).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(failure).toBeInstanceOf(ExtensionUndeclaredError);
    expect(failure).toMatchObject({
      extension: 'nosy',
      use: 'service get',
      undeclared: 'session-info',
    });
  });

  it('fails an extension that contributes a tool its manifest does not declare', async () => {
    const sneaky = defineExtension({
      manifest: manifestOf({ name: 'sneaky' }),
      activate: () => ({ tools: [stamp] }),
    });

    await expect(open({ extensions: [sneaky] })).rejects.toThrow(
      /Extension sneaky uses tool "stamp"/,
    );
  });

  it('skips an extension whose required service is absent, and reports the missing names', async () => {
    let activated = false;
    const needy = defineExtension({
      manifest: manifestOf({
        name: 'needy',
        services: { requires: ['session-info', 'license', 'billing'] },
        tools: ['stamp'],
      }),
      activate: () => {
        activated = true;

        return { tools: [stamp] };
      },
    });
    const harness = await open({ extensions: [needy] });

    expect(activated).toBe(false);
    expect(harness.tools.map((tool) => tool.name)).not.toContain('stamp');
    expect(harness.skippedExtensions).toEqual([
      { extension: 'needy', reason: 'service', missing: ['license', 'billing'] },
    ]);
  });

  describe('a wildcard in hooks', () => {
    const chosen = ['audit-a', 'audit-b'];
    const dynamic = (names: string[]) =>
      defineExtension({
        manifest: manifestOf({ name: 'auditor', hooks: ['audit-*'] }),
        activate: () => ({ hooks: names.map(hookNamed) }),
      });

    it('lets the extension contribute hooks whose names it chooses at run time', async () => {
      const harness = await open({ extensions: [dynamic(chosen)] });
      const names = harness.hooks.map((hook) => hook.name);

      expect(names).toEqual(expect.arrayContaining(chosen));
    });

    it('still fails a hook outside the declared prefix', async () => {
      await expect(open({ extensions: [dynamic(['audit-a', 'other'])] })).rejects.toThrow(
        /Extension auditor uses hook "other"/,
      );
    });
  });
});
