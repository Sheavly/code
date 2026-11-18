import type { EmitFailure } from '../emit/emit.types.js';
import { quotedName } from '../emit/quoted-name.utils.js';

/**
 * An extension's emit was refused: it ran before `activate` passed the host's check or after the
 * host stopped the extension, the host has no sink, the kind or topic is not one the extension
 * contributed, its `data` fails the schema, the finished envelope fails the protocol's, or the
 * contribution itself (a name or version) is invalid. Names the extension and the kind or topic,
 * quoted and truncated in the message. The message never holds the data's values: `problem` is
 * built from schema issue paths and codes only.
 */
export class ExtensionEmitError extends Error {
  override name = 'ExtensionEmitError';
  readonly extension: string;
  /** The event kind or notice topic the emit was for, as the caller wrote it (not sanitised). */
  readonly emitted: string;
  readonly failure: EmitFailure;

  constructor(params: {
    extension: string;
    emitted: string;
    failure: EmitFailure;
    problem: string;
    /** What the schema or the data threw, kept off the message because it can echo the data. */
    cause?: unknown;
  }) {
    const { extension, emitted, failure, problem, cause } = params;

    super(`Extension ${extension} cannot emit ${quotedName(emitted)}: ${problem}`, { cause });
    this.extension = extension;
    this.emitted = emitted;
    this.failure = failure;
  }
}
