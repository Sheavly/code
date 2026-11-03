/**
 * A prompt named skills that don't exist: a UI's picked skills (`parts`) are exact, so a stale
 * list is the caller's to fix, never quietly sent as text.
 */
export class UnknownSkillError extends Error {
  override name = 'UnknownSkillError';
  readonly skills: readonly string[];

  constructor(params: { skills: readonly string[] }) {
    const { skills } = params;

    super(`No skill is called ${skills.join(', ')}`);
    this.skills = skills;
  }
}
