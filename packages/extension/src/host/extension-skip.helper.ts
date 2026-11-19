import type { Extension, ServiceConsumer } from '../extension/extension.types.js';
import type { ExtensionHostOptions, SkippedExtension } from './extension-host.types.js';
import type { ServiceRegistry } from './services.service.js';

/**
 * Only a declared builtin skips the gate: any other origin value is code to trust first. The
 * check is called on `options`, not detached from it, so an `isTrusted` written as a method that
 * uses `this` sees the options object the app passed.
 */
async function isTrustedToRun(params: {
  extension: Extension;
  options: Pick<ExtensionHostOptions, 'isTrusted'>;
}): Promise<boolean> {
  const { extension, options } = params;

  if (extension.origin === undefined || extension.origin === 'builtin') return true;

  return (await options.isTrusted?.(extension)) === true;
}

/**
 * Why an extension does not activate, if it does not: a dependency that did not, code that is
 * not trusted, or a required service nobody offers it. Building a factory service for `consumer`
 * is part of the last check: the instance is the one a later read returns.
 */
export async function skipReasonOf(params: {
  extension: Extension;
  consumer: ServiceConsumer;
  services: ServiceRegistry;
  /** The host's options, whose `isTrusted` is called as a method of them. */
  options: Pick<ExtensionHostOptions, 'isTrusted'>;
  unavailable: ReadonlySet<string>;
  readable: ReadonlySet<string>;
}): Promise<SkippedExtension | undefined> {
  const { extension, consumer, services, options, unavailable, readable } = params;
  const skip = { extension: extension.name } as const;

  if (extension.dependsOn.some((name) => unavailable.has(name))) {
    return { ...skip, reason: 'dependency' };
  }

  if (!(await isTrustedToRun({ extension, options }))) return { ...skip, reason: 'untrusted' };

  const missing = services.unreadable({
    extension: consumer,
    required: extension.manifest.services.requires,
    readable,
  });

  return missing.length === 0 ? undefined : { ...skip, reason: 'service', missing };
}
