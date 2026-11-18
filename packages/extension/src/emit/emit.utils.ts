import { extensionEventSchema } from '@sheavly/protocol/event/event.validator';
import { extensionNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import type { z } from 'zod';
import { ExtensionEmitError } from '../errors/emit.errors.js';
import { assertDeclared, declaredNoticeTopics } from '../host/declaration.utils.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';
import type { EmitFailure, Emitter, ExtensionEmitSink, RecordedEmit } from './emit.types.js';

/** The contributions an emitter may emit, as they were when the host checked them. */
type Armed = {
  events: ReadonlyMap<string, RecordedEmit>;
  notices: ReadonlyMap<string, RecordedEmit>;
};

/** Where the capability is in its life: it starts idle, is armed once, and is disarmed for good. */
type State = { kind: 'idle' } | { kind: 'armed'; armed: Armed } | { kind: 'disarmed' };

/** Who emits what, for the refusals: the extension and the kind or topic. */
type Subject = { extension: string; emitted: string };

/** The path and code of each schema issue, never its message or input, which can echo the data. */
function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'} (${issue.code})`).join(', ');
}

/** Throws the `ExtensionEmitError` for `failure`. */
function refuse(
  params: Subject & { failure: EmitFailure; problem: string; cause?: unknown },
): never {
  throw new ExtensionEmitError(params);
}

/**
 * `data` as the extension's own schema parsed it. Throws an `ExtensionEmitError` when it fails
 * (the message holds issue paths and codes, never values) or when the schema or the data throws
 * (a cycle, deep nesting, a throwing getter): what was thrown is never printed.
 */
function parsedData(params: Subject & { registered: RecordedEmit; data: unknown }): unknown {
  const { registered, data, ...subject } = params;
  let parsed: z.ZodSafeParseResult<unknown>;

  try {
    parsed = registered.schema.safeParse(data);
  } catch (caughtError) {
    return refuse({
      ...subject,
      failure: 'invalid-data',
      problem: 'data could not be checked: its schema or the data threw',
      cause: caughtError,
    });
  }

  if (!parsed.success) {
    return refuse({
      ...subject,
      failure: 'invalid-data',
      problem: `data does not match its schema at ${describeIssues(parsed.error.issues)}`,
    });
  }

  return parsed.data;
}

/**
 * The finished `envelope` as the protocol's own `schema` reads it, so what reaches the sink is
 * what the stream and history will accept: the name and namespace, the version, the text and
 * data caps. Throws an `ExtensionEmitError` (`invalid-envelope`, with issue paths and codes only;
 * `invalid-data` when the check itself threw on hostile data).
 */
function checkedEnvelope<TSchema extends z.ZodType>(
  params: Subject & { schema: TSchema; envelope: unknown },
): z.output<TSchema> {
  const { schema, envelope, ...subject } = params;
  let parsed: z.ZodSafeParseResult<z.output<TSchema>>;

  try {
    parsed = schema.safeParse(envelope);
  } catch (caughtError) {
    return refuse({
      ...subject,
      failure: 'invalid-data',
      problem: 'the envelope could not be checked: its data or text threw',
      cause: caughtError,
    });
  }

  if (!parsed.success) {
    return refuse({
      ...subject,
      failure: 'invalid-envelope',
      problem: `the envelope is invalid at ${describeIssues(parsed.error.issues)}`,
    });
  }

  return parsed.data;
}

/**
 * The recorded contribution for an event kind. A kind the manifest does not declare throws an
 * `ExtensionUndeclaredError`; a declared one the extension never contributed, an
 * `ExtensionEmitError`.
 */
function registeredEvent(params: {
  manifest: ExtensionManifest;
  armed: Armed;
  kind: string;
}): RecordedEmit {
  const { manifest, armed, kind } = params;
  const registered = armed.events.get(kind);

  if (registered !== undefined) return registered;

  assertDeclared({
    extension: manifest.name,
    use: 'event',
    name: kind,
    allowed: manifest.emits.events,
    declareIn: 'emits.events',
  });

  return refuse({
    extension: manifest.name,
    emitted: kind,
    failure: 'not-contributed',
    problem: 'activate did not return it in its events, with the schema of its data',
  });
}

/** Like `registeredEvent`, for a notice topic (declared by `emits.modelFacingNotices`). */
function registeredNotice(params: {
  manifest: ExtensionManifest;
  armed: Armed;
  topic: string;
}): RecordedEmit {
  const { manifest, armed, topic } = params;
  const registered = armed.notices.get(topic);

  if (registered !== undefined) return registered;

  assertDeclared({
    extension: manifest.name,
    use: 'notice',
    name: topic,
    allowed: declaredNoticeTopics(manifest),
    declareIn: 'emits.modelFacingNotices (set it to true)',
  });

  return refuse({
    extension: manifest.name,
    emitted: topic,
    failure: 'not-contributed',
    problem: 'activate did not return it in its notices, with the schema of its data',
  });
}

/**
 * The emit capability of `manifest`'s extension. Nothing can be emitted until `arm` is called
 * (the host does it after `activate` returned and its contributions passed the manifest check),
 * then only what the extension contributed, and nothing again once `disarm` is called. The
 * envelope's `extension` and `version` are the host's: the caller supplies neither. The finished
 * envelope is parsed with the protocol's own schema before the sink sees it. Without a `sink`,
 * an emit throws.
 */
export function createEmitter(params: {
  manifest: ExtensionManifest;
  sink: ExtensionEmitSink | undefined;
}): Emitter {
  const { manifest, sink } = params;
  const extension = manifest.name;
  let state: State = { kind: 'idle' };

  /** The armed contributions and the sink, or the refusal that says which is missing. */
  function ready(emitted: string): { armed: Armed; sink: ExtensionEmitSink } {
    if (state.kind === 'idle') {
      return refuse({
        extension,
        emitted,
        failure: 'not-activated',
        problem: 'it is not activated yet: emit from a tool, hook or task, after activate returned',
      });
    }

    if (state.kind === 'disarmed') {
      return refuse({
        extension,
        emitted,
        failure: 'deactivated',
        problem: 'the host stopped this extension, so it can no longer emit',
      });
    }

    if (sink === undefined) {
      return refuse({
        extension,
        emitted,
        failure: 'no-sink',
        problem: 'the host was given no emit sink, so nothing can carry it',
      });
    }

    return { armed: state.armed, sink };
  }

  return {
    emit: {
      event: ({ kind, data, text, session }) => {
        const target = ready(kind);
        const registered = registeredEvent({ manifest, armed: target.armed, kind });
        const subject = { extension, emitted: kind };
        const event = checkedEnvelope({
          ...subject,
          schema: extensionEventSchema,
          envelope: {
            type: 'extension_event',
            extension,
            kind,
            version: registered.version,
            data: parsedData({ ...subject, registered, data }),
            text,
          },
        });

        target.sink({ kind: 'event', session: session?.id, event });
      },
      notice: ({ topic, data, text, session }) => {
        const target = ready(topic);
        const registered = registeredNotice({ manifest, armed: target.armed, topic });
        const subject = { extension, emitted: topic };
        const notice = checkedEnvelope({
          ...subject,
          schema: extensionNoticeSchema,
          envelope: {
            kind: 'extension-notice',
            extension,
            topic,
            version: registered.version,
            data: parsedData({ ...subject, registered, data }),
            text,
          },
        });

        target.sink({ kind: 'notice', session: session?.id, notice });
      },
    },
    arm: ({ events, notices }) => {
      if (state.kind === 'disarmed') return;

      state = {
        kind: 'armed',
        armed: {
          events: new Map(events.map((recorded) => [recorded.name, recorded])),
          notices: new Map(notices.map((recorded) => [recorded.name, recorded])),
        },
      };
    },
    disarm: () => {
      state = { kind: 'disarmed' };
    },
  };
}
