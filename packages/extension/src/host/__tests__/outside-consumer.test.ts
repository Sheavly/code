/**
 * An extension written the way a third party writes it: its own `sheavly.json` and TypeScript in
 * a throwaway directory outside every package's sources, importing only package specifiers. It is
 * type-checked under the repo's compiler options and run through a real `ExtensionHost`, so a
 * subpath the packages' `exports` do not expose, a missing key or a missing error fails here
 * instead of passing because a relative path happened to work inside the monorepo.
 */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '@sheavly/core/tool/tool.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ExtensionActivationError } from '../../errors/extension.errors.js';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import { ScopeDeactivatedError } from '../../errors/scopes.errors.js';
import { hostServiceFor } from '../../extension/extension.utils.js';
import { requireGrant } from '../../extension/grants.utils.js';
import { SESSION_INFO } from '../../run-services/run-services.utils.js';
import { importSpecifiers, typeCheckOutside } from '../../testing/outside-typecheck.fake.js';
import {
  loadOutsideExtension,
  useOutsideWorkspaces,
} from '../../testing/outside-workspace.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const ALLOWED_SPECIFIER = /^(@sheavly\/(extension|core|protocol)\/|zod$)/;
const GRANT = 'session:read';
const toolContext: ToolContext = { callId: callIdSchema.parse('call-1'), description: 'count' };

const openWorkspace = useOutsideWorkspaces();

/** The `session-info` service a host supplies: `list` needs the grant and records who read it. */
function sessionInfoHost() {
  const listedBy: string[] = [];
  const service = hostServiceFor({
    key: SESSION_INFO,
    grants: [GRANT],
    create: (consumer) => {
      let armed = true;

      return {
        value: {
          get: () => undefined,
          list: () => {
            if (!armed) {
              throw new ScopeDeactivatedError({
                extension: consumer.name,
                service: 'session-info',
              });
            }

            requireGrant({
              extension: consumer.name,
              grants: consumer.manifest.grants,
              grant: GRANT,
            });
            listedBy.push(consumer.name);

            return [];
          },
          isReleased: () => false,
          releasedStarts: () => [],
          onLifecycle: () => () => undefined,
        },
        disarm: () => {
          armed = false;
        },
      };
    },
  });

  return { service, listedBy };
}

/** A host over the fixture workspace's extension, ready to activate. */
async function hostOver(params: { grants: readonly string[] }) {
  const workspace = await openWorkspace(params);
  const extension = await loadOutsideExtension(workspace.entry);
  const supplied = sessionInfoHost();
  const host = new ExtensionHost({ extensions: [extension], services: [supplied.service] });

  return { host, listedBy: supplied.listedBy };
}

describe('an extension built from public exports only', () => {
  it('type-checks under the repo compiler options, every import resolved through an exports map', async () => {
    const workspace = await openWorkspace({ grants: [GRANT] });

    expect(typeCheckOutside(workspace)).toEqual([]);
  });

  it('imports only package specifiers the packages expose: none relative, none into src', async () => {
    const { source } = await openWorkspace({ grants: [GRANT] });
    const specifiers = importSpecifiers(source);

    expect(specifiers.length).toBeGreaterThan(5);

    for (const specifier of specifiers) {
      expect(specifier, specifier).toMatch(ALLOWED_SPECIFIER);
      expect(specifier, specifier).not.toContain('/src/');
      expect(specifier.startsWith('.'), specifier).toBe(false);
    }
  });

  it('activates, merges its tool and hook, and reads the scoped service with its grant', async () => {
    const { host, listedBy } = await hostOver({ grants: [GRANT] });
    const result = await host.activate({ signal });

    expect(result.failed).toEqual([]);
    expect(result.active).toEqual(['outside-notes']);
    expect(result.contributions.tools.map((tool) => tool.name)).toEqual(['count_sessions']);
    expect(result.contributions.hooks.map((hook) => hook.name)).toEqual(['outside-session-note']);
    expect(listedBy).toEqual(['outside-notes']);

    const [tool] = result.contributions.tools;
    const added: string[] = [];
    const [hook] = result.contributions.hooks;

    await hook?.sessionStart?.({
      messages: [],
      signal,
      addContext: (content) => added.push(content),
    });

    expect(added).toEqual(['Sessions at start: 0 sessions']);
    expect(await tool?.execute({ input: {}, signal, context: toolContext })).toBe('0 sessions');
    expect(listedBy).toEqual(['outside-notes', 'outside-notes']);
  });

  it('has its tool report the scope gone, through the public error, once the host deactivates it', async () => {
    const { host } = await hostOver({ grants: [GRANT] });
    const result = await host.activate({ signal });
    const [tool] = result.contributions.tools;

    await host.deactivate();

    expect(await tool?.execute({ input: {}, signal, context: toolContext })).toBe(
      'sessions unavailable',
    );
  });

  it('fails its activation with the undeclared-grant error when the manifest lacks the grant', async () => {
    const { host, listedBy } = await hostOver({ grants: [] });
    const result = await host.activate({ signal });
    const [failed] = result.failed;

    expect(result.active).toEqual([]);
    expect(failed).toBeInstanceOf(ExtensionActivationError);
    expect(failed?.cause).toBeInstanceOf(ExtensionUndeclaredError);
    expect(failed?.cause).toMatchObject({
      extension: 'outside-notes',
      use: 'grant',
      undeclared: GRANT,
    });
    expect(listedBy).toEqual([]);
  });
});

describe('the outside check catches what a monorepo-internal test would let through', () => {
  const withImport = (line: string) =>
    `${line}\nexport const outsideExtension = undefined;\nexport const used = typeof SESSION_INFO;\n`;

  it('reports a deep import of a path the exports map does not expose', async () => {
    const workspace = await openWorkspace({
      grants: [GRANT],
      source: withImport(
        "import { SESSION_INFO } from '@sheavly/extension/src/run-services/run-services.utils.js';",
      ),
    });

    expect(typeCheckOutside(workspace).join('\n')).toContain('TS2307');
  });

  it('reports an import of a package that is not a public dependency', async () => {
    const workspace = await openWorkspace({
      grants: [GRANT],
      source: withImport("import { SESSION_INFO } from '@sheavly/runtime/sessions/session.utils';"),
    });

    expect(typeCheckOutside(workspace).join('\n')).toContain('TS2307');
  });

  it('flags a relative import and a path into src in the specifier scan', () => {
    const specifiers = importSpecifiers(
      "import a from '../../core/src/x.js';\nimport b from '@sheavly/core/src/y';",
    );

    expect(specifiers.filter((specifier) => ALLOWED_SPECIFIER.test(specifier))).toEqual([
      '@sheavly/core/src/y',
    ]);
    expect(specifiers.filter((specifier) => specifier.includes('/src/'))).toHaveLength(2);
  });
});
