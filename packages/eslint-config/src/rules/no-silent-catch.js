// A catch has to look at the error it caught: to rethrow it, check it (`code`, `instanceof`) or
// pass it on (`cause`, a report). One that never reads it turns every failure into a default
// (`[]`, `undefined`, "doesn't exist") or a new error without its cause, and nobody learns what
// went wrong: a guard silently allows, a store silently forgets.

const MESSAGE =
  'Catch narrowly: rethrow, or check the error (`code`, `instanceof`) and handle only what you expect, with a comment saying why; pass it on as `cause` when you rethrow with a better message. Never turn every error into a default.';

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** `.catch(fn)` gives `fn`; `.then(ok, fn)` gives `fn`. Only inline functions can be checked. */
function rejectionHandler(node) {
  const { callee } = node;

  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return null;

  const handler = { catch: node.arguments[0], then: node.arguments[1] }[callee.property.name];

  return handler && FUNCTION_TYPES.has(handler.type) ? handler : null;
}

export const noSilentCatch = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { silent: MESSAGE },
  },
  create(context) {
    const { sourceCode } = context;
    /** True if the caught error (the variable `node` declares) is read somewhere. */
    const usesError = (node) =>
      sourceCode.getDeclaredVariables(node).some((variable) => variable.references.length > 0);

    return {
      CatchClause(node) {
        if (!usesError(node)) context.report({ node, messageId: 'silent' });
      },
      CallExpression(node) {
        const handler = rejectionHandler(node);

        if (handler && !usesError(handler)) context.report({ node: handler, messageId: 'silent' });
      },
    };
  },
};
