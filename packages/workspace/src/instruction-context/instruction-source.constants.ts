/**
 * The largest instruction file read: far above any real AGENTS.md, so it never trims one, but it
 * stops a huge or endless file from filling memory and the model's context every turn.
 */
export const MAX_INSTRUCTION_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Where each built-in instruction source sits among the registered ones (lower first). A new
 * source picks a number here instead of a position in an array.
 */
export const INSTRUCTION_ORDER = {
  agentsMd: 10,
  skills: 20,
  scratch: 30,
  workingRoot: 40,
} as const;
