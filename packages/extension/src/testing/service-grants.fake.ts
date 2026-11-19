import { ExtensionUndeclaredError } from '../errors/manifest.errors.js';
import { ExtensionHost } from '../host/extension-host.service.js';
import { fakeExtension } from './extension.fake.js';
import type { ServiceGrantsParams } from './extension-fake.types.js';

const PROBE = 'grant-probe';
const signal = new AbortController().signal;

/**
 * What `call` throws when run on `params.service` as a consumer of `params.provider` that holds
 * exactly `grants`; `undefined` when it does not throw. Builds a real `ExtensionHost` per run.
 */
async function runAs<TService>(
  params: ServiceGrantsParams<TService> & {
    grants: readonly string[];
    call: (scope: TService) => unknown;
  },
): Promise<unknown> {
  const { provider, service, grants, call, services, alongside = [] } = params;
  const held: { scope?: TService } = {};
  const consumer = fakeExtension({
    name: PROBE,
    dependsOn: [provider.name],
    requires: [service.name],
    grants,
    activate: (context) => {
      held.scope = context.services.get(service);

      return {};
    },
  });
  const host = new ExtensionHost({ extensions: [...alongside, provider, consumer], services });

  try {
    const { failed, skipped } = await host.activate({ signal });

    if (held.scope === undefined) {
      const why = failed.map((failure) => describeThrown(failure.cause ?? failure)).join('; ');

      throw new Error(
        `the probe consumer could not read ${service.name}: failed ${why || 'none'}, skipped ${JSON.stringify(skipped)}`,
      );
    }

    try {
      await call(held.scope);
    } catch (caughtError) {
      return caughtError;
    }

    return undefined;
  } finally {
    await host.deactivate();
  }
}

function describeThrown(thrown: unknown): string {
  return thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : typeof thrown;
}

function isGrantRefusal(error: unknown): error is ExtensionUndeclaredError {
  return error instanceof ExtensionUndeclaredError && error.use === 'grant';
}

/**
 * Proves that each call in `calls` refuses a consumer without its grant, for every grant the
 * provider's manifest declares in `services.grants` for `service`. For each grant it builds a
 * real `ExtensionHost` with the provider and a consumer that lists the service in `requires` and
 * holds every other declared grant: `calls[grant](scope)` must throw the `ExtensionUndeclaredError`
 * (`use: 'grant'`) naming that consumer and that grant. With the grant held, the same call must not
 * throw an `ExtensionUndeclaredError` (it may throw anything else: only the grant error is judged).
 *
 * Rejects (throws a plain `Error`) when `calls` lacks a declared grant or names one the provider
 * does not declare, so a test cannot cover less than the manifest. It proves each listed call
 * enforces its grant, not that the calls cover every method of the service.
 */
export async function assertServiceEnforcesGrants<TService>(
  params: ServiceGrantsParams<TService>,
): Promise<void> {
  const { provider, service, calls } = params;
  const declared = provider.manifest.services?.grants?.[service.name] ?? [];
  const listed = Object.keys(calls);
  const missing = declared.filter((grant) => !listed.includes(grant));
  const unknown = listed.filter((grant) => !declared.includes(grant));

  if (declared.length === 0) {
    throw new Error(`${provider.name} declares no services.grants for ${service.name}`);
  }

  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `calls must match the grants ${provider.name} declares for ${service.name} (${declared.join(', ')}): missing [${missing.join(', ')}], not declared [${unknown.join(', ')}]`,
    );
  }

  for (const grant of declared) {
    const call = calls[grant]!;
    const refused = await runAs({
      ...params,
      call,
      grants: declared.filter((other) => other !== grant),
    });

    if (!isGrantRefusal(refused) || refused.extension !== PROBE || refused.undeclared !== grant) {
      throw new Error(
        `${provider.name}: ${service.name} did not refuse a consumer without the grant ${grant}: ${refused === undefined ? 'the call did not throw' : describeThrown(refused)}`,
      );
    }

    const allowed = await runAs({ ...params, call, grants: declared });

    if (allowed instanceof ExtensionUndeclaredError) {
      throw new Error(
        `${provider.name}: ${service.name} refused a consumer that holds ${grant}: ${allowed.message}`,
      );
    }
  }
}
