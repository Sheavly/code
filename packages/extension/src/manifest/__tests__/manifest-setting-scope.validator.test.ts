import { describe, expect, it } from 'vitest';
import { extensionManifestSchema } from '../manifest.validator.js';

const setting = (fields: Record<string, unknown>) => ({
  name: 'notes.max',
  type: 'number',
  default: 5,
  description: 'How many',
  ...fields,
});

/** The messages of every problem in a manifest declaring `settings`. */
function problems(settings: unknown[]): string[] {
  const parsed = extensionManifestSchema.safeParse({ name: 'notes', settings });

  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** The path of every problem, dotted. */
function problemPaths(settings: unknown[]): string[] {
  const parsed = extensionManifestSchema.safeParse({ name: 'notes', settings });

  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('a setting’s scope and restricted fields', () => {
  it('default to scope "user" and not restricted', () => {
    const parsed = extensionManifestSchema.parse({ name: 'notes', settings: [setting({})] });

    expect(parsed.settings[0]).toMatchObject({ scope: 'user', restricted: false });
  });

  it('accept a project setting, restricted or not', () => {
    expect(problems([setting({ scope: 'project' })])).toEqual([]);
    expect(problems([setting({ scope: 'project', restricted: true })])).toEqual([]);
  });

  it('reject a scope that is neither "user" nor "project"', () => {
    expect(problemPaths([setting({ scope: 'workspace' })])).toEqual(['settings.0.scope']);
  });

  it('reject a restricted that is not a boolean', () => {
    expect(problemPaths([setting({ scope: 'project', restricted: 'yes' })])).toEqual([
      'settings.0.restricted',
    ]);
  });

  it('reject restricted on a user setting, saying a restricted setting must be project', () => {
    expect(problemPaths([setting({ restricted: true })])).toEqual(['settings.0.restricted']);
    expect(problems([setting({ scope: 'user', restricted: true })])[0]).toMatch(
      /restricted setting must have scope "project"/,
    );
  });
});

describe('a setting whose name looks like a credential', () => {
  it.each([
    'notes.api-key',
    'notes.access-token',
    'notes.token',
    'notes.secret',
    'notes.db-password',
    'notes.credential',
    'notes.passwd',
    'notes.apikey',
    'notes.key',
    'notes.max-key-length',
    'notes.pwd',
    'notes.db-pwd',
    'notes.bearer',
    'notes.passphrase',
    'notes.auth',
    'notes.http-auth',
    'notes.accesstoken',
    'notes.secretkey',
    'notes.privatekey',
  ])('is rejected: %s', (name) => {
    expect(problemPaths([setting({ name })])).toEqual(['settings.0.name']);
    expect(problems([setting({ name })])[0]).toMatch(/looks like a credential/);
  });

  it.each([
    'notes.monkey',
    'notes.keyboard-layout',
    'notes.tokenizer',
    'notes.secretary',
    'notes.passwords-dir',
    'notes.max-tokens',
    'notes.max-lines',
    'notes.author',
    'notes.authority',
    'notes.pwdx',
    'notes.bearers',
  ])('is accepted, since only a whole segment counts: %s', (name) => {
    expect(problems([setting({ name })])).toEqual([]);
  });

  it('is judged on the setting part, not the extension part', () => {
    const parsed = extensionManifestSchema.safeParse({
      name: 'token-counter',
      settings: [setting({ name: 'token-counter.limit' })],
    });

    expect(parsed.success).toBe(true);
  });

  it('is never read as another type: a secret type does not exist', () => {
    expect(problemPaths([setting({ type: 'secret', default: 'x' })]).length).toBe(1);
  });
});
