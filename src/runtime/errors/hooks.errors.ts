import type { Hook } from '@sheavly/core/hook/hook.types';
import { errorMessage } from './errors.utils.js';

/** Which hook handler failed. */
type HookHandler = Exclude<keyof Hook, 'name'>;

/**
 * A hook's handler threw where its failure must not stop the run (`onError`): the run's own error
 * is still the one thrown, and this is reported to the host as a `hook_failed` event.
 */
export class HookError extends Error {
  override name = 'HookError';
  readonly hook: string;
  readonly handler: HookHandler;

  constructor(params: { hook: string; handler: HookHandler; cause: unknown }) {
    const { hook, handler, cause } = params;

    super(`Hook ${hook} failed in ${handler}: ${errorMessage(cause)}`, { cause });
    this.hook = hook;
    this.handler = handler;
  }
}

/** The run's event stream ended without its `done` event, so the run's outcome is unknown. */
export class StreamEndedError extends Error {
  override name = 'StreamEndedError';

  constructor() {
    super('Agent stream ended without a done event');
  }
}
