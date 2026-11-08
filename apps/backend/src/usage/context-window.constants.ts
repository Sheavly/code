/**
 * The context window the agent is told for a model that sets none: the same for every model,
 * since the backend can't know what a deployment or gateway really serves. Under the 272K input
 * size above which the GPT-6 models are priced higher, so an agent paced by it stays on the
 * ordinary rate. A model's file sets its own (`contextWindow`), e.g. 1,000,000 for the full window.
 */
export const DEFAULT_CONTEXT_WINDOW = 300_000;
