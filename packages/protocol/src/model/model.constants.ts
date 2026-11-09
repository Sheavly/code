/**
 * The context sizes every UI offers to pick from, in tokens, with what it calls each. They are
 * rounded on purpose: what the agent paces itself by, not any provider's exact window (a 1M
 * model's is a little over). The backend takes any positive size, so a model may have another.
 */
export const CONTEXT_WINDOW_CHOICES = [
  { size: 300_000, label: '300K' },
  { size: 1_000_000, label: '1M' },
] as const;

/** The size a model that sets none is told; a host may give a model another. */
export const DEFAULT_CONTEXT_WINDOW = 300_000;

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
