import type { ContributionKind } from '../extension/extension.types.js';

/**
 * An extension is defined wrong (`defineExtension`): a bad name, a dependency on itself.
 * Thrown when the extension is defined, so it fails at startup.
 */
export class ExtensionDefinitionError extends Error {
  override name = 'ExtensionDefinitionError';
  /** The extension's name as written. */
  readonly extension: string;

  constructor(params: { extension: string; problem: string }) {
    super(`Extension ${params.extension}: ${params.problem}`);
    this.extension = params.extension;
  }
}

/** Two contributions (or two services) share a name. Names both extensions, so one can be renamed. */
export class ContributionCollisionError extends Error {
  override name = 'ContributionCollisionError';
  readonly contribution: ContributionKind;
  readonly contributionName: string;
  /** The extension that contributed it first, and the one that tried to add it again. */
  readonly extensions: readonly [string, string];

  constructor(params: {
    contribution: ContributionKind;
    contributionName: string;
    first: string;
    second: string;
  }) {
    const { contribution, contributionName, first, second } = params;

    super(
      `The ${contribution} "${contributionName}" is contributed by both ${first} and ${second}. Rename one of them.`,
    );
    this.contribution = contribution;
    this.contributionName = contributionName;
    this.extensions = [first, second];
  }
}

/** The extensions can't be put in an order: a missing or cyclic dependency, a repeated name. */
export class ExtensionGraphError extends Error {
  override name = 'ExtensionGraphError';
  /** The extensions the problem is about, in the order the message names them. */
  readonly extensions: readonly string[];

  constructor(params: { extensions: readonly string[]; problem: string }) {
    super(params.problem);
    this.extensions = params.extensions;
  }
}

/**
 * A setting was read by an extension that did not declare it, or the user's values for the
 * settings are wrong (an undeclared name, a value of another type than the default's).
 */
export class ExtensionSettingError extends Error {
  override name = 'ExtensionSettingError';
  /** The setting's name, and the extension that read it, when an extension was reading. */
  readonly setting: string;
  readonly extension: string | undefined;

  constructor(params: { setting: string; extension?: string; problem: string }) {
    super(
      params.extension === undefined
        ? `Setting "${params.setting}": ${params.problem}`
        : `Extension ${params.extension} cannot read setting "${params.setting}": ${params.problem}`,
    );
    this.setting = params.setting;
    this.extension = params.extension;
  }
}

/** The hooks' `before`/`after` constraints can't all hold: a cycle, or a hook placed against itself. */
export class HookOrderError extends Error {
  override name = 'HookOrderError';
  /** The hooks involved, in the order the message names them. */
  readonly hooks: readonly string[];

  constructor(params: { hooks: readonly string[]; problem: string }) {
    super(params.problem);
    this.hooks = params.hooks;
  }
}

/** A service was read that nobody provided, or that the reader did not declare a dependency on. */
export class MissingServiceError extends Error {
  override name = 'MissingServiceError';
  readonly service: string;
  readonly reader: string;

  constructor(params: { service: string; reader: string; problem: string }) {
    super(`${params.reader} cannot read service "${params.service}": ${params.problem}`);
    this.service = params.service;
    this.reader = params.reader;
  }
}

/** The host was asked for something its state does not allow: activating twice, or after it was closed. */
export class ExtensionHostStateError extends Error {
  override name = 'ExtensionHostStateError';
  /** What was asked, and the state the host was in. */
  readonly attempted: string;
  readonly state: string;

  constructor(params: { attempted: string; state: string }) {
    super(
      `An extension host cannot ${params.attempted} while it is ${params.state}: it activates once and closes once per session.`,
    );
    this.attempted = params.attempted;
    this.state = params.state;
  }
}

/** One extension's `activate` threw. The others carry on; the host reports this one. */
export class ExtensionActivationError extends Error {
  override name = 'ExtensionActivationError';
  readonly extension: string;

  constructor(params: { extension: string; cause: unknown }) {
    const reason = params.cause instanceof Error ? params.cause.message : String(params.cause);

    super(`Extension ${params.extension} failed to activate: ${reason}`, { cause: params.cause });
    this.extension = params.extension;
  }
}
