import { connectBackend } from './backend.helper.js';
import type { Backend, BackendOptions } from './client.types.js';

/**
 * Runs `run` on a backend and always stops it after, whether `run` returns or throws; a backend
 * that fails to start is stopped by `connectBackend` itself. A backend only connected to is left
 * running, as `stop` does for one.
 */
export async function withBackend<T>(params: {
  options: BackendOptions;
  run: (backend: Backend) => Promise<T>;
}): Promise<T> {
  const backend = await connectBackend(params.options);

  try {
    return await params.run(backend);
  } finally {
    await backend.stop();
  }
}
