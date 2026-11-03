// No raw `Error` in source: every error it creates is a typed class that callers can catch by
// class instead of by matching its message. Each workspace keeps its own in `src/errors/`
// (`@sheavly/providers` keeps `providers.errors.ts`); `hooks.errors.mjs` for the Cursor hooks. Covers
// `throw new Error(...)` and every other construction (`reject(new Error(...))`,
// `Promise.reject(Error(...))`), so none slips through a variable.
//
// Exempt, by path: tests and fakes (`__tests__/`, `testing/`, `*.fake.ts`), whose errors are
// test values, and root `scripts/`, one-off tooling whose errors only ever reach a terminal.

const EXEMPT = /(^|\/)(__tests__|testing|scripts)\/|\.fake\.ts$/;

const MESSAGE =
  "No raw `Error` in source: throw a typed error class from this workspace's `src/errors/` (or the hooks' `hooks.errors.mjs`), with the fields to act on and the original as `cause`. Add a class if none fits. Only scripts, tests and fakes may use `Error`.";

/** True if `Error` at `node` is the global one, not a local or imported binding. */
function isGlobalError(params) {
  const { node, sourceCode } = params;

  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get('Error');

    if (variable) return variable.defs.length === 0;
  }

  return true;
}

/**
 * The file's path from the workspace root (ESLint's `cwd`), `/`-separated, so `EXEMPT` never
 * matches a folder above the project (a checkout inside `~/scripts/`).
 */
function relativePath(context) {
  const { filename, cwd } = context;
  const relative = filename.startsWith(`${cwd}/`) ? filename.slice(cwd.length + 1) : filename;

  return relative.split('\\').join('/');
}

export const noRawError = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    if (EXEMPT.test(relativePath(context))) return {};

    const { sourceCode } = context;
    const check = (node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'Error') return;
      if (isGlobalError({ node, sourceCode })) context.report({ node, messageId: 'raw' });
    };

    return { NewExpression: check, CallExpression: check };
  },
};
