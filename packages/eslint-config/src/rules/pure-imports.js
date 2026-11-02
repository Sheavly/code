// `*.utils.ts` and `*.validator.ts` are pure: no I/O modules, and no services, helpers, tools or
// adapters (a helper may do I/O). Type-only imports are fine: they vanish at runtime. Its own rule
// rather than a reused `no-restricted-imports`, which ESLint only exposes through a deprecated API.

const BANNED_SOURCE =
  /^(node:)?(fs|fs\/promises|child_process|net|http|https|os|readline|worker_threads)$|\.(service|helper|tool|adapter|fake)(\.js)?$/;

function isTypeOnly(node) {
  if (node.importKind === 'type') return true;

  return (
    node.specifiers.length > 0 &&
    node.specifiers.every((specifier) => specifier.importKind === 'type')
  );
}

export const pureImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      impure:
        '`*.utils.ts` and `*.validator.ts` are pure: no I/O modules, and no services, helpers, tools or adapters. Move the code that needs `{{source}}` into a `*.helper.ts` (or a `*.service.ts` if it owns state), or pass the result in.',
    },
  },
  create(context) {
    const check = (node, source) => {
      if (typeof source === 'string' && BANNED_SOURCE.test(source)) {
        context.report({ node, messageId: 'impure', data: { source } });
      }
    };

    return {
      ImportDeclaration: (node) => {
        if (!isTypeOnly(node)) check(node, node.source.value);
      },
      ImportExpression: (node) => {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },
    };
  },
};
