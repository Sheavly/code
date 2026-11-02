/** `.sheavly/hooks.json` or a hook file it lists could not be read, validated or loaded. */
export class ProjectHooksError extends Error {
  override name = 'ProjectHooksError';
}
