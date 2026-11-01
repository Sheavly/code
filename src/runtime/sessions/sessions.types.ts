import type { SessionRef } from '@sheavly/core/session/session.types';
import type { SessionRegistry } from './sessions.service.js';

/** The session a run belongs to: which registry it is tracked in, and which session it is. */
export type RunSession = {
  registry: SessionRegistry;
  ref: SessionRef;
};
