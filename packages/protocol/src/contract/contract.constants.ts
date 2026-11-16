/** The contract's JSON Schema, committed at the package root (`npm run schema -w @sheavly/protocol`). */
export const CONTRACT_SCHEMA_FILE = 'contract.schema.json';

/**
 * The wire contract's version, published as `contractVersion` in the JSON Schema. Raise it for a
 * change a stored conversation or an older client cannot read; adding an optional field does not.
 * The harness reads only data written under the current version: a field made required drops the
 * data that lacks it, with no compatibility reader (see "Version" in docs/contract.md).
 */
export const CONTRACT_VERSION = 1;

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
