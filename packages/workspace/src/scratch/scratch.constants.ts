/** Permissions of the scratch root and the agent folders in it: owner only. */
export const SCRATCH_MODE = 0o700;

/** The mode bits (group write, other write) a scratch folder must not have. */
export const GROUP_OR_WORLD_WRITE = 0o022;

/** Scratch entries not modified for this long are removed by `pruneScratch`: 14 days. */
export const SCRATCH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
