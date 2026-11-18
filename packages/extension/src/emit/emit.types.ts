import type { AgentEventBody } from '@sheavly/protocol/event/event.types';
import type { PersistentNotice } from '@sheavly/protocol/notice/notice.types';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import type { z } from 'zod';

/**
 * The event an extension emits, as the stream carries it: `{ type: 'extension_event', extension,
 * kind, version, data, text }`. The host fills `extension` and `version`; the extension never does.
 */
export type ExtensionEvent = Extract<AgentEventBody, { type: 'extension_event' }>;

/**
 * The notice an extension emits, as history stores it: `{ kind: 'extension-notice', extension,
 * topic, version, data, text }`. Only `text` reaches the model, never `data`.
 */
export type ExtensionNotice = Extract<PersistentNotice, { kind: 'extension-notice' }>;

/** One finished, validated emission: what the host hands the app's sink. */
export type ExtensionEmission =
  | {
      kind: 'event';
      /** The session it belongs to; absent means the conversation's main session. */
      session?: SessionRef['id'] | undefined;
      event: ExtensionEvent;
    }
  | {
      kind: 'notice';
      /** The session whose model is told; absent means the conversation's main session. */
      session?: SessionRef['id'] | undefined;
      notice: ExtensionNotice;
    };

/**
 * What the app supplies (`ExtensionHostOptions.emit`) to carry an emission to its session. It
 * receives only envelopes the host already checked, so it need not validate them. It is
 * synchronous: it may throw (an unknown or ended session) and the error reaches the emitting
 * extension, but an async sink's rejection would not.
 */
export type ExtensionEmitSink = (emission: ExtensionEmission) => void;

/** An event kind an extension contributes: its `data` schema and the version of that shape. */
export type EventContribution = {
  /** `<extension>.<name>`, and listed in the manifest's `emits.events`. */
  kind: string;
  /** Bump it when the shape of `data` changes, so a consumer that knows a version can tell. */
  version: number;
  /** The schema `data` must parse against; checked on every emit. */
  schema: z.ZodType;
};

/** A notice topic an extension contributes: its `data` schema and the version of that shape. */
export type NoticeContribution = {
  /** `<extension>.<name>`; the manifest must set `emits.modelFacingNotices`. */
  topic: string;
  version: number;
  schema: z.ZodType;
};

/** Why an emit was refused, as `ExtensionEmitError.failure`. */
export type EmitFailure =
  | 'not-activated'
  | 'deactivated'
  | 'no-sink'
  | 'not-contributed'
  | 'invalid-data'
  | 'invalid-envelope'
  | 'invalid-contribution';

/**
 * What the host recorded of one contributed kind or topic when it checked the contribution: the
 * name and version read once, validated, and the schema (held by reference: the host cannot copy
 * a schema, so one that changes its own behaviour later is the extension's responsibility).
 */
export type RecordedEmit = {
  name: string;
  version: number;
  schema: z.ZodType;
};

/** What an emit call says; the version, the extension's name and the checks are the host's. */
type EmitBase = {
  /** Plain-text fallback a UI shows when it does not know the kind; for a notice, what the model reads. */
  text: string;
  /** The session it belongs to (a tool passes `context.session`). Default: the main session. */
  session?: SessionRef | undefined;
};

/**
 * What an extension emits through, built for that one extension by the host. Each call is held
 * to the manifest and to what the extension contributed, and the extension's name in the envelope
 * is the host's. It is a host-checked gate, not a sandbox: an extension is Node code, and one with
 * the `sessions` run service can still publish or queue a notice itself.
 */
export type ExtensionEmit = {
  /**
   * Publishes an event on the session's stream, not stored in history. Throws when called before
   * `activate` has returned and passed the host's check, or after the host stopped the extension
   * (`deactivated`), when `kind` is not one this extension contributed and declared, when `data`
   * fails its schema, when the finished envelope fails the protocol's schema (the `text` and
   * `data` caps included), and when the host has no sink.
   */
  event: (params: EmitBase & { kind: string; data: unknown }) => void;
  /**
   * Queues a notice for the session's model at its next turn; it is stored in history. Throws
   * like `event`, and when the manifest's `emits.modelFacingNotices` is not true.
   */
  notice: (params: EmitBase & { topic: string; data: unknown }) => void;
};

/** An extension's emit capability, and the switches the host flips around its life. */
export type Emitter = {
  emit: ExtensionEmit;
  /**
   * Lets `emit` work, for exactly these recorded contributions (names and versions the host read
   * once at its check; the schemas are held by reference). Has no effect once disarmed.
   */
  arm: (contributions: {
    events: readonly RecordedEmit[];
    notices: readonly RecordedEmit[];
  }) => void;
  /**
   * Ends the capability for good: every later `emit` throws an `ExtensionEmitError` with failure
   * `deactivated`. The host calls it wherever it stops, drops or fails the extension.
   */
  disarm: () => void;
};
