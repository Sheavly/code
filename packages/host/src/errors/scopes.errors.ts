import type { SessionId } from '@sheavly/protocol/session/session.types';

/**
 * A scoped run service was used after the host stopped the extension it was built for
 * (deactivated, rolled back or failed to activate). A scope an extension kept past that is dead:
 * it names the extension and the service so the leak is found.
 */
export class ScopeDeactivatedError extends Error {
  override name = 'ScopeDeactivatedError';
  readonly extension: string;
  readonly service: string;

  constructor(params: { extension: string; service: string }) {
    const { extension, service } = params;

    super(`The "${service}" service of extension "${extension}" was used after it deactivated`);
    this.extension = extension;
    this.service = service;
  }
}

/**
 * A scope method was called without something it must have, such as the session a task control
 * call is about: left out, it would read as every session of the run.
 */
export class ScopeArgumentError extends Error {
  override name = 'ScopeArgumentError';
}

/** `runChild` was called for a child whose run has not returned yet: one loop per session. */
export class ChildRunningError extends Error {
  override name = 'ChildRunningError';
  readonly sessionId: SessionId;

  constructor(params: { sessionId: SessionId }) {
    super(`Session ${params.sessionId} is already running; wait for its run to end`);
    this.sessionId = params.sessionId;
  }
}
