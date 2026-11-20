import type { z } from 'zod';

/** The contract as one JSON Schema document: every type under `$defs`, by name. */
export type ContractJsonSchema = {
  $schema: string;
  /** `PROTOCOL_VERSION`: the `@sheavly/protocol` version this document describes. */
  contractVersion: string;
  $defs: Record<string, z.core.JSONSchema.BaseSchema>;
};
