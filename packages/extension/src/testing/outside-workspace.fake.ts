import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import type { Extension } from '../extension/extension.types.js';

/** This repository's root: the one place a third party's `node_modules` is linked from. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The packages an extension author may depend on, and the only ones the workspace links. */
const PUBLIC_PACKAGES = ['@sheavly/extension', '@sheavly/core', '@sheavly/protocol', 'zod'];

/** The fixture extension's file inside a workspace, and the export it holds its extension in. */
const ENTRY = 'src/outside-notes.helper.ts';

/** What a third party writes: imports through package specifiers only. */
const FIXTURE_SOURCE = `import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { ScopeDeactivatedError } from '@sheavly/extension/errors/scopes.errors';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import type { SessionInfoView } from '@sheavly/extension/run-services/run-services.types';
import { SESSION_INFO } from '@sheavly/extension/run-services/run-services.utils';
import { z } from 'zod';

const manifest = readManifest(new URL('../sheavly.json', import.meta.url));

function describeSessions(info: SessionInfoView): string {
  try {
    return info.list().length + ' sessions';
  } catch (caughtError) {
    if (caughtError instanceof ScopeDeactivatedError) return 'sessions unavailable';

    throw caughtError;
  }
}

export const outsideExtension = defineExtension({
  manifest,
  activate: ({ services }) => {
    const info = services.get(SESSION_INFO);
    const atStart = describeSessions(info);

    return {
      tools: [
        defineTool({
          name: 'count_sessions',
          description: 'Says how many sessions the run has.',
          inputSchema: z.object({}),
          execute: async () => describeSessions(info),
        }),
      ],
      hooks: [
        defineHook({
          name: 'outside-session-note',
          sessionStart: async ({ addContext }) => {
            addContext('Sessions at start: ' + atStart);
          },
        }),
      ],
    };
  },
});
`;

/** The `sheavly.json` of the fixture, asking for `grants`. */
function manifestText(grants: readonly string[]): string {
  return JSON.stringify({
    name: 'outside-notes',
    services: { requires: ['session-info'] },
    grants,
    tools: ['count_sessions'],
    hooks: ['outside-session-note'],
  });
}

/** `node_modules/<name>` as a link to the package the repo's workspace holds under that name. */
async function linkPackage(params: { dir: string; name: string }) {
  const { dir, name } = params;
  const target = await realpath(path.join(REPO_ROOT, 'node_modules', name));
  const link = path.join(dir, 'node_modules', name);

  await mkdir(path.dirname(link), { recursive: true });
  await symlink(target, link, 'dir');
}

/**
 * A throwaway workspace on disk holding a third-party extension: its own `package.json`,
 * `sheavly.json` (asking for `grants`) and one TypeScript file (`source`, the public-imports
 * fixture by default). Its `node_modules` links only the public packages, so the packages' own
 * `exports` maps decide what it can import. Removed after each test.
 */
export function useOutsideWorkspaces() {
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  return async (params: { grants: readonly string[]; source?: string }) => {
    const { grants, source = FIXTURE_SOURCE } = params;
    const dir = await mkdtemp(path.join(tmpdir(), 'sheavly-outside-'));

    made.push(dir);
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(path.join(dir, 'sheavly.json'), manifestText(grants));
    await writeFile(path.join(dir, ENTRY), source);

    for (const name of PUBLIC_PACKAGES) await linkPackage({ dir, name });

    return { dir, entry: path.join(dir, ENTRY), source };
  };
}

/** The repo's root, for reading its compiler configuration. */
export function repoRoot(): string {
  return REPO_ROOT;
}

/**
 * Imports the fixture's TypeScript from its temp directory, through the test runner, so its
 * `@sheavly/*` specifiers resolve through the packages' `exports` maps like any consumer's.
 */
export async function loadOutsideExtension(entry: string): Promise<Extension> {
  const loaded = (await import(entry)) as { outsideExtension: Extension };

  return loaded.outsideExtension;
}
