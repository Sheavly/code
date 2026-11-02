import type { SessionRegistry } from './sessions.service.js';
import type { SessionRef } from '@sheavly/protocol/session/session.types';

/** The session a run belongs to: which registry it is tracked in, and which session it is. */
export type RunSession = {
  registry: SessionRegistry;
  ref: SessionRef;
};
