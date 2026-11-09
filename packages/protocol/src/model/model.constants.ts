/**
 * The context sizes a model can be set to, in tokens. Rounded on purpose: they are what the agent
 * is told to pace itself by, not any provider's exact window (a 1M model's is a little over).
 */
export const CONTEXT_WINDOW_SIZES = [300_000, 1_000_000] as const;

/** The size a model that sets none is told. */
export const DEFAULT_CONTEXT_WINDOW = 300_000;

/** What a UI calls each size. */
export const CONTEXT_WINDOW_LABELS = {
  300_000: '300K',
  1_000_000: '1M',
} satisfies Record<(typeof CONTEXT_WINDOW_SIZES)[number], string>;

/**
 * The fields of a model's file that belong to the envelope (`ModelFile`). An adapter's own fields
 * can't use these names: the rest of the file is its definition.
 */
export const RESERVED_MODEL_FIELDS = [
  'id',
  'name',
  'adapter',
  'pricing',
  'identity',
  'contextWindow',
] as const;
