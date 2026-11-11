import { kindOfFile } from '../file-kinds.js';
import { isImpurePromptSource, promptPurityVisitors } from './prompt-purity.utils.js';

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
      promptEffect:
        'A `*.prompt.ts` is pure text/data/rendering: no direct I/O, model calls, environment/global state, module side effects or mutation of inputs/shared data. Pass the data in; move effects to a helper/service. Fresh local rendering buffers may be updated.',
      promptImport:
        'A `*.prompt.ts` imports only pure code/data, never side-effect imports or I/O/model/state modules. Pass the data in instead of importing `{{source}}`.',
      promptTypeImport:
        'Types in a `*.prompt.ts` must use `import type` (or an inline `type` specifier).',
      impure:
        '`*.utils.ts` and `*.validator.ts` are pure: no I/O modules, and no services, helpers, tools or adapters. Move the code that needs `{{source}}` into a `*.helper.ts` (or a `*.service.ts` if it owns state), or pass the result in.',
    },
  },
  create(context) {
    const isPrompt = kindOfFile(context.filename) === 'prompt';
    const check = (node, source) => {
      if (typeof source !== 'string') return;

      const banned = BANNED_SOURCE.test(source) || (isPrompt && isImpurePromptSource(source));

      if (banned) {
        context.report({ node, messageId: isPrompt ? 'promptImport' : 'impure', data: { source } });
      }
    };

    return {
      ...(isPrompt ? promptPurityVisitors(context) : {}),
      ImportDeclaration: (node) => {
        if (isTypeOnly(node)) return;

        if (isPrompt && node.specifiers.length === 0) {
          context.report({ node, messageId: 'promptImport', data: { source: node.source.value } });

          return;
        }

        if (isPrompt && /\.types(?:\.(?:js|ts))?$/.test(node.source.value)) {
          context.report({ node, messageId: 'promptTypeImport' });
        }

        check(node, node.source.value);
      },
      ImportExpression: (node) => {
        if (isPrompt) {
          context.report({ node, messageId: 'promptEffect' });

          return;
        }

        if (node.source.type === 'Literal') check(node, node.source.value);
      },
    };
  },
};
