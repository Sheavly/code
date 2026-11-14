/**
 * A skill folder or its `harness.json` can't be used: names the file and what is wrong, so the
 * post-edit hook and the lint plugin report it the same way instead of matching on a message.
 */
export class SkillMetadataError extends Error {
  name = 'SkillMetadataError';

  constructor(params) {
    const { file, problem, cause } = params;

    super(`${file}: ${problem}`, cause === undefined ? undefined : { cause });
    this.file = file;
    this.problem = problem;
  }
}
