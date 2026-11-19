import type {
  OutputCapture,
  OutputReader,
} from '@sheavly/extension/run-services/run-services.types';
import type { ScopeGuard } from './scope-guard.service.js';

/** `OutputReader` for one extension: every method needs `output:read`. */
export class OutputReaderScope implements OutputReader {
  readonly #guard: ScopeGuard<'output-reader'>;
  readonly #store: OutputReader;

  constructor(params: { guard: ScopeGuard<'output-reader'>; store: OutputReader }) {
    this.#guard = params.guard;
    this.#store = params.store;
    Object.freeze(this);
  }

  // Async, as the contract says every method rejects: a refusal is a rejection, never a throw.
  log: OutputReader['log'] = async (ref) => {
    this.#guard.enter('log');

    return await this.#store.log(ref);
  };

  read: OutputReader['read'] = async (params) => {
    this.#guard.enter('read');

    return await this.#store.read(params);
  };

  search: OutputReader['search'] = async (params) => {
    this.#guard.enter('search');

    return await this.#store.search(params);
  };
}

/** `OutputCapture` for one extension: `create` needs `output:capture`, since it fills the store's quota. */
export class OutputCaptureScope implements OutputCapture {
  readonly #guard: ScopeGuard<'output-capture'>;
  readonly #store: OutputCapture;

  constructor(params: { guard: ScopeGuard<'output-capture'>; store: OutputCapture }) {
    this.#guard = params.guard;
    this.#store = params.store;
    Object.freeze(this);
  }

  create: OutputCapture['create'] = async () => {
    this.#guard.enter('create');

    return await this.#store.create();
  };
}
