/**
 * The fields of a model's file that belong to the envelope (`ModelFile`). An adapter's own fields
 * can't use these names: the rest of the file is its definition.
 */
export const RESERVED_MODEL_FIELDS = ['id', 'name', 'adapter', 'pricing', 'identity'] as const;
