import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';

// The guard rules: fail loudly (no silent catch, no raw Error), branded ids, sound "is inside".
const ruleTester = typescriptRuleTester();

ruleTester.run('no-silent-catch', harnessPlugin.rules['no-silent-catch'], {
  valid: [
    // Narrowed: handles the expected code, rethrows the rest.
    "try { f(); } catch (caughtError) { if (caughtError.code === 'ENOENT') return null; throw caughtError; }",
    'try { f(); } catch (caughtError) { if (!(caughtError instanceof SyntaxError)) throw caughtError; }',
    // A better message keeps the cause.
    "try { f(); } catch (caughtError) { throw new Error('reading x', { cause: caughtError }); }",
    // Reported: the error is handed on.
    'try { f(); } catch (caughtError) { report(caughtError); }',
    "p.catch((caughtError) => { if (caughtError.code !== 'ESRCH') throw caughtError; });",
    'p.then(ok, (caughtError) => Promise.reject(caughtError));',
    // A named handler is checked where it is defined, not here.
    'p.catch(ignoreRejection);',
  ],
  invalid: [
    'try { f(); } catch {}',
    'try { f(); } catch { return null; }',
    'try { f(); } catch (caughtError) { return []; }',
    // A new error without the one caught loses its cause.
    "try { f(); } catch { throw new Error('not found'); }",
    'p.catch(() => []);',
    'p.catch(() => undefined);',
    "p.catch(() => { throw new Error('not found'); });",
    'p.then(() => true, () => false);',
    'p.catch(function () { return null; });',
  ].map((code) => ({ code, errors: [{ messageId: 'silent' }] })),
});

const RAW = "throw new Error('boom');";

ruleTester.run('no-raw-error', harnessPlugin.rules['no-raw-error'], {
  valid: [
    "throw new WorkspaceError('outside');",
    'throw new PathCheckError({ path, cause });',
    // The class itself extends Error: that's not a construction.
    "class HookError extends Error { name = 'HookError'; }",
    // A local or imported binding named Error is someone else's class.
    "import { Error } from './errors.js'; throw new Error('x');",
    "function f(Error) { return new Error('x'); }",
    'throw caughtError;',
    // Exempt: tests, fakes and root scripts may use Error.
    ...[
      'src/tools/edit-file/__tests__/edit-file.tool.test.ts',
      'src/testing/fake-fetch.fake.ts',
      'packages/core/src/testing/echo-tool.fake.ts',
      '.cursor/hooks/__tests__/git-hooks.test.mjs',
      'packages/eslint-config/src/__tests__/plugin.test.js',
      'scripts/jscpd-runner.mjs',
    ].map((filename) => ({ code: RAW, filename })),
  ],
  invalid: [
    ...[
      "throw new Error('boom');",
      "throw Error('boom');",
      "reject(new Error('Interrupted'));",
      "return Promise.reject(new Error('No one is listening'));",
      "const failure = new Error('later'); throw failure;",
      "throw new Error('reading x', { cause });",
    ].map((code) => ({ code, filename: 'src/runtime/x/x.service.ts' })),
    // Every other source area, the providers and the packages included.
    ...[
      'packages/providers/src/responses/responses.helper.ts',
      'packages/core/src/tool/tool.helper.ts',
      'src/workbook/store.service.ts',
      '.cursor/hooks/hooks.utils.mjs',
      // Only a folder named exactly like an exempt one counts.
      'src/tools/scripts-runner/scripts-runner.tool.ts',
    ].map((filename) => ({ code: RAW, filename })),
  ].map((test) => ({ ...test, errors: [{ messageId: 'raw' }] })),
});

// Branded ids: schemas brand them, and "is inside" checks hold for a folder named `..x/`.
ruleTester.run('branded-ids', harnessPlugin.rules['branded-ids'], {
  valid: [
    "export const sessionIdSchema = z.string().brand<'SessionId'>();",
    'const ref = z.object({ id: sessionIdSchema, parentId: sessionIdSchema.exactOptional() });',
    'const call = z.object({ callId: callIdSchema, name: z.string() });',
    // Not ids: names, and words that only end in "id" (`paid`, `valid`).
    'const x = z.object({ title: z.string(), paid: z.boolean(), valid: z.string() });',
    // Not zod: a plain object with an id is data, not a schema.
    "const value = { id: 'a1' };",
    "const branded = z.object({ id: z.string().min(1).brand<'RunId'>() });",
  ],
  invalid: [
    ...[
      'const x = z.object({ id: z.string() });',
      'const x = z.object({ sessionId: z.string().exactOptional() });',
      "const x = z.object({ callId: z.string().min(1).describe('the call') });",
      "const x = z.object({ 'taskId': z.string() });",
    ].map((code) => ({ code, errors: [{ messageId: 'unbranded' }] })),
    {
      code: 'export const runIdSchema = z.string().min(1);',
      errors: [{ messageId: 'unbrandedSchema' }],
    },
  ],
});

ruleTester.run('no-dotdot-prefix', harnessPlugin.rules['no-dotdot-prefix'], {
  valid: [
    "const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);",
    "if (name.startsWith('.')) return;",
    "if (rel.startsWith('../')) return;",
  ],
  invalid: [
    "const inside = !relative.startsWith('..');",
    "if (relative.startsWith('..') || path.isAbsolute(relative)) throw failure;",
  ].map((code) => ({ code, errors: [{ messageId: 'm0' }] })),
});

ruleTester.run('no-adhoc-latest-request', harnessPlugin.rules['no-adhoc-latest-request'], {
  valid: [
    "import { latestRequest } from '@sheavly/core/history/history.utils'; const request = latestRequest(history);",
    // Other lookups are not about the request.
    "const last = history.findLastIndex((entry) => entry.role === 'summary');",
    "const reply = messages.findLast((m) => m.role === 'assistant');",
    "const found = history.find((entry) => entry.role === 'user');",
  ],
  invalid: [
    "const latest = history.findLast((entry) => entry.role === 'user');",
    "const at = history.findLastIndex((message) => message.role === 'user');",
    "const typed = history.findLastIndex((m) => m.role === 'user' && m.id);",
    "const latestUser = messages.findLast((message): message is Message => message.role === 'user');",
  ].map((code) => ({ code, errors: [{ messageId: 'm0' }] })),
});

ruleTester.run('no-adhoc-main-session', harnessPlugin.rules['no-adhoc-main-session'], {
  valid: [
    "import { isMainSession } from '@sheavly/protocol/session/session.utils'; const main = sessions.find(isMainSession);",
    'const nests = child.depth < MAX_SESSION_DEPTH;',
    'const deeper = session.depth > 1;',
    'const depth = parent.depth + 1;',
    'const isChild = parent.depth + 1 === child.depth;',
    'const one = count === 1;',
  ],
  invalid: [
    'const main = sessions.find((session) => session.depth === 1);',
    'if (entry.event.session.depth === 1) report();',
    'const isChild = session.depth !== 1;',
    'const main = sessions.filter((s) => s.depth == 1);',
    'const main = 1 === session.depth;',
  ].map((code) => ({ code, errors: [{ messageId: 'm0' }] })),
});

ruleTester.run('no-direct-clock', harnessPlugin.rules['no-direct-clock'], {
  valid: [
    "import { now } from '@sheavly/core/clock/clock.helper'; const startedAt = now();",
    "import { DateTime } from 'luxon'; const label = DateTime.fromMillis(at).toFormat('HH:mm');",
    "import { DateTime } from 'luxon'; const noon = DateTime.utc(2026, 11, 2, 12).toMillis();",
    'const started = performance.now();', // a monotonic timer, not a date
    'const later = new Dates();', // some other class
    'const schema = z.number().int();',
  ],
  invalid: [
    { code: 'const startedAt = Date.now();', messageId: 'm0' },
    { code: 'const elapsed = Date.now() - startedAt;', messageId: 'm0' },
    { code: 'const at = new Date(ms);', messageId: 'm1' },
    { code: 'const at = Date.UTC(2026, 10, 2);', messageId: 'm2' },
    { code: 'const at = Date.parse(text);', messageId: 'm2' },
    // ISO 8601 in any form: writing it, reading it, or taking it in a schema.
    { code: 'const at = new Date(ms).toISOString();', errors: ['m3', 'm1'] },
    { code: "const at = DateTime.fromISO('2026-11-02');", messageId: 'm3' },
    { code: 'const day = DateTime.now().toISODate();', messageId: 'm3' },
    { code: 'const iso = DateTime.now().toISO();', messageId: 'm3' },
    { code: 'const time = z.iso.datetime();', errors: ['m4'] },
  ].map(({ code, messageId, errors }) => ({
    code,
    errors: (errors ?? [messageId]).map((id) => ({ messageId: id })),
  })),
});

// The credentials file holds every model's key: only `CredentialStore` reads it, and only the
// backend uses the store.
ruleTester.run('no-credentials-file', harnessPlugin.rules['no-credentials-file'], {
  valid: [
    // Other files, and the names that only look like it.
    "const file = path.join(root, 'config.json');",
    "const file = path.join(profile, 'models', `${id}.json`);",
    "const file = 'credentials.jsonl';",
    "const file = 'my-credentials.json';",
    "const file = 'credentials.json.bak';",
    "const folder = 'credentials';",
    // A sentence that mentions the name is not a path.
    "const message = 'Do not commit credentials.json';",
    "throw new Failure({ reason: 'it is not the credentials.json you meant' });",
    // Nothing to read in a name that isn't spelled out.
    'const file = path.join(profile, CREDENTIALS_FILE);',
  ],
  invalid: [
    // The file, however it is written.
    "const file = path.join(profile, 'credentials.json');",
    "const file = 'credentials.json';",
    "const file = './credentials.json';",
    "const file = '/home/u/.sheavly/profiles/p/credentials.json';",
    "const file = 'C:\\\\Users\\\\u\\\\.sheavly\\\\profiles\\\\p\\\\credentials.json';",
    // macOS and Windows ignore case, so these are the same file.
    "const file = 'Credentials.JSON';",
    "const file = path.join(profile, 'CREDENTIALS.json');",
    // A template literal, with the folder before it.
    'const file = `${profile}/credentials.json`;',
    'const file = `${profile}\\\\credentials.json`;',
    'const file = `credentials.json`;',
    // Read from the usual places.
    "const text = await readFile(path.join(dir, 'credentials.json'), 'utf8');",
    "const text = readFileSync('credentials.json');",
    'await exec(`cat ${dir}/credentials.json`);',
  ].map((code) => ({ code, errors: [{ messageId: 'm0' }] })),
});

ruleTester.run('no-key-holder-import', harnessPlugin.rules['no-key-holder-import'], {
  valid: [
    "import { ModelStore } from '@sheavly/storage/model-store/model-store.service';",
    "import { ConfigStore } from '@sheavly/storage/config-store/config-store.service';",
    "import { ProfileStore } from '@sheavly/storage/profile-store/profile-store.service';",
    "import { readJsonFile } from '@sheavly/storage/json-file/json-file.helper';",
    // Another package's module that happens to be named alike.
    "import { CredentialStore } from './credential-store.service.js';",
    "import { x } from '@sheavly/core/credential-store/x.helper';",
    "import { x } from '@sheavly/core/profile-registry/x.helper';",
    "import { x } from '@sheavly/storage-extras/credential-store/x.service';",
    "import { x } from '@sheavly/storage/profile-registry-extras/x.service';",
  ],
  invalid: [
    // The credential store, whatever file kind of it is imported.
    "import { CredentialStore } from '@sheavly/storage/credential-store/credential-store.service';",
    "import type { Secrets } from '@sheavly/storage/credential-store/credential-store.types';",
    "import { credentialsFileSchema } from '@sheavly/storage/credential-store/credential-store.validator';",
    "const { CredentialStore } = await import('@sheavly/storage/credential-store/credential-store.service');",
    // The profile registry hands out the same keys through an open profile: the same door.
    "import { ProfileRegistry } from '@sheavly/storage/profile-registry/profile-registry.service';",
    "import type { OpenProfile } from '@sheavly/storage/profile-registry/profile-registry.types';",
    "const { ProfileRegistry } = await import('@sheavly/storage/profile-registry/profile-registry.service');",
  ].map((code) => ({
    code,
    languageOptions: { sourceType: 'module', ecmaVersion: 'latest' },
    errors: [{ messageId: 'm0' }],
  })),
});
