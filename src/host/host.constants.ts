/** Model calls per session (main and each sub-agent): room for multi-step sub-agent work. */
export const HOST_MAX_TURNS = 20;

/** Ctrl+C under `npx tsx` reaches node twice; a second SIGINT this soon is the same keypress. */
export const SAME_KEYPRESS_MS = 500;
