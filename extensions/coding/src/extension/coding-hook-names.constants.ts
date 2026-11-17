/**
 * The names of the coding extension's built-in instruction hooks, in the order they run. They are
 * a stable contract: a third-party extension positions its own hooks against them with
 * `placeHook({ hook, before: [CODING_HOOK_NAMES.agentsMd] })`, so changing one is a breaking
 * change. `scratch` is written as a literal in `@sheavly/workspace` (a package cannot import an
 * extension); the coding extension's tests pin it here.
 */
export const CODING_HOOK_NAMES = {
  agentsMd: 'agents-md',
  skills: 'skills',
  scratch: 'scratch',
  workingRoot: 'working-root',
} as const;
