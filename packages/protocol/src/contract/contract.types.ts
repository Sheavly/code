import type { z } from 'zod';

/** The contract as one JSON Schema document: every type under `$defs`, by name. */
export type ContractJsonSchema = {
  $schema: string;
  /** `CONTRACT_VERSION`: which revision of the contract this document describes. */
  contractVersion: number;
  $defs: Record<string, z.core.JSONSchema.BaseSchema>;
};
