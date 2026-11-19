import type {
  OutputCapture,
  OutputReader,
} from '@sheavly/extension/run-services/run-services.types';
import type { ScopeGuard } from './scope-guard.service.js';

/** `OutputReader` for one extension: every method needs `output:read`. */
export class OutputReaderScope implements OutputReader {
  readonly #guard: ScopeGuard;
  readonly #store: OutputReader;

  constructor(params: { guard: ScopeGuard; store: OutputReader }) {
    this.#guard = params.guard;
    this.#store = params.store;
    Object.freeze(this);
  }

  // Async, as the contract says every method rejects: a refusal is a rejection, never a throw.
  log: OutputReader['log'] = async (ref) => {
    this.#guard.check('output:read');

    return await this.#store.log(ref);
  };

  read: OutputReader['read'] = async (params) => {
    this.#guard.check('output:read');

    return await this.#store.read(params);
  };

  search: OutputReader['search'] = async (params) => {
    this.#guard.check('output:read');

    return await this.#store.search(params);
  };
}

/** `OutputCapture` for one extension: `create` needs `output:capture`, since it fills the store's quota. */
export class OutputCaptureScope implements OutputCapture {
  readonly #guard: ScopeGuard;
  readonly #store: OutputCapture;

  constructor(params: { guard: ScopeGuard; store: OutputCapture }) {
    this.#guard = params.guard;
    this.#store = params.store;
    Object.freeze(this);
  }

  create: OutputCapture['create'] = async () => {
    this.#guard.check('output:capture');

    return await this.#store.create();
  };
}
