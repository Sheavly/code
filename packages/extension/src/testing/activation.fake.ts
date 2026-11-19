import { ExtensionActivationError } from '../errors/extension.errors.js';
import type { Contributions } from '../extension/extension.types.js';
import { defineExtension } from '../extension/extension.utils.js';
import { ExtensionHost } from '../host/extension-host.service.js';
import type { ActivationResult } from '../host/extension-host.types.js';
import { extensionManifestSchema } from '../manifest/manifest.validator.js';
import type { FakeExtensionFields } from './extension-fake.types.js';
import { fakeExtension } from './extension.fake.js';

const signal = new AbortController().signal;

/** What activating an `ExtensionHost` over `fakeExtension(fields)` for each of `extensions` gives. */
export function activateFakes(extensions: FakeExtensionFields[]): Promise<ActivationResult> {
  return new ExtensionHost({
    extensions: extensions.map((fields) => fakeExtension(fields)),
  }).activate({ signal });
}

/**
 * What activating one extension gives when it is defined plainly, from a parsed manifest literal
 * (`manifest` is what a `sheavly.json` would hold) and an `activate` returning `contributes`, with
 * no fake in between.
 */
export function activatePlain(params: {
  manifest: unknown;
  contributes: Contributions;
}): Promise<ActivationResult> {
  const plain = defineExtension({
    manifest: extensionManifestSchema.parse(params.manifest),
    activate: () => params.contributes,
  });

  return new ExtensionHost({ extensions: [plain] }).activate({ signal });
}

/**
 * The `cause` of the one failure of `result`, which must be an `ExtensionActivationError`.
 * Throws when there is not exactly one failure or it is another error.
 */
export function onlyFailureCause(result: ActivationResult): unknown {
  const [failed] = result.failed;

  if (result.failed.length !== 1 || !(failed instanceof ExtensionActivationError)) {
    throw new Error(`expected exactly one ExtensionActivationError, got ${result.failed.length}`);
  }

  return failed.cause;
}
