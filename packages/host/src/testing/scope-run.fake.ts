import type { OutputStore } from '@sheavly/core/output/output.types';
import type { Services } from '@sheavly/extension/extension/extension.types';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';
import { fakeExtension, fakeTool } from '@sheavly/extension/testing/extension.fake';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createHarness } from '../host/host.helper.js';
import { runServices } from '../run-services/run-services.helper.js';
import type { RunLoop } from '../run-services/run-services.types.js';
import { noSubAgentRuns } from './run-loop.fake.js';

/**
 * What a fake extension of a `scopeRun` declares: the services it reads, the grants it holds and
 * the tools its manifest names (declared, and contributed only when `contributes` lists them).
 */
type ScopedExtension = {
  name: string;
  requires: string[];
  optional?: string[];
  grants: string[];
  tools?: string[];
  /** Tools it contributes (and so declares): trivial tools of these names. */
  contributes?: string[];
  /** Runs inside `activate`, with the services the extension was given. */
  during?: (services: Services) => Promise<void>;
};

/**
 * Test-only: a real harness (real session and task registries) whose run services are built as
 * an app builds them. `activate` runs fake extensions over them; `servicesOf(name)` is the view
 * of the services one of them was given, so a test calls the scopes the way an extension would,
 * and the `deactivate` it returns stops them as the host does at the end of a session.
 */
export function scopeRun(options: { outputs?: OutputStore; runSession?: RunLoop } = {}) {
  const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
  const seen = new Map<string, Services>();

  return {
    harness,
    async activate(extensions: ScopedExtension[]) {
      const host = new ExtensionHost({
        extensions: extensions.map(({ contributes = [], during, ...fields }) => {
          const tools = contributes.map((name) => fakeTool(name));

          return fakeExtension({
            ...fields,
            contributes: { tools },
            activate: async ({ services }) => {
              seen.set(fields.name, services);
              await during?.(services);

              return { tools };
            },
          });
        }),
        services: runServices({
          harness,
          outputs: options.outputs,
          runSession: options.runSession ?? noSubAgentRuns,
        }),
      });
      const result = await host.activate({ signal: new AbortController().signal });

      return { result, deactivate: () => host.deactivate() };
    },
    servicesOf(name: string): Services {
      const services = seen.get(name);

      if (!services) throw new Error(`${name} did not activate`);

      return services;
    },
  };
}
