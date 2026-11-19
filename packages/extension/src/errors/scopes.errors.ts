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
