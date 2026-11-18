import { quotedName } from '../emit/quoted-name.utils.js';
import type { UndeclaredUse } from '../extension/extension.types.js';

/**
 * A `sheavly.json` cannot be used: the file is missing, is not JSON, or does not follow the
 * schema (an unknown key, a wrong type). Names the file and lists every problem found.
 */
export class ExtensionManifestError extends Error {
  override name = 'ExtensionManifestError';
  /** The manifest file as it was given, for the message. */
  readonly file: string;

  constructor(params: { file: string; problem: string; cause?: unknown }) {
    super(`Extension manifest ${params.file}: ${params.problem}`, { cause: params.cause });
    this.file = params.file;
  }
}

/**
 * An extension did something its manifest does not declare: it read or provided a service, or
 * contributed a tool, hook or work kind, that `sheavly.json` does not list. Names the extension,
 * what it did and the name, so the manifest or the code can be fixed.
 */
export class ExtensionUndeclaredError extends Error {
  override name = 'ExtensionUndeclaredError';
  readonly extension: string;
  readonly use: UndeclaredUse;
  readonly undeclared: string;

  constructor(params: {
    extension: string;
    use: UndeclaredUse;
    undeclared: string;
    /** The manifest field to add it to, for the message. */
    declareIn: string;
  }) {
    const { extension, use, undeclared, declareIn } = params;

    super(
      `Extension ${extension} uses ${use} ${quotedName(undeclared)}, which its sheavly.json does not declare: add it to ${declareIn}.`,
    );
    this.extension = extension;
    this.use = use;
    this.undeclared = undeclared;
  }
}
