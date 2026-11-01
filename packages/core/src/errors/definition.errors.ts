/**
 * A tool or hook is defined wrong (`defineTool`, `defineHook`): a reserved input field, a hook
 * that handles nothing. Thrown when the definition is made, so it fails at startup, not mid-run.
 */
export class DefinitionError extends Error {
  override name = 'DefinitionError';
  /** What was being defined. */
  readonly definition: 'tool' | 'hook';
  /** The tool's or hook's name. */
  readonly defined: string;

  constructor(params: { definition: 'tool' | 'hook'; defined: string; problem: string }) {
    const { definition, defined, problem } = params;

    super(`${definition === 'tool' ? 'Tool' : 'Hook'} ${defined}: ${problem}`);
    this.definition = definition;
    this.defined = defined;
  }
}
