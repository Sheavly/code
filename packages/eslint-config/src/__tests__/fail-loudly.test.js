import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

// The guard rules: fail loudly (no silent catch, no raw Error), branded ids, sound "is inside".
const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

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
