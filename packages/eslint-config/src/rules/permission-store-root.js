// A repo's worktrees share one mode and allow list because the permission store is keyed by the
// folder's place in the main worktree (`permissionRoot`), not by the folder itself. A call that
// hands the store a path of its own silently splits the shared list again.
//
// For each `read`, `setMode`, `allow` or `revoke` called on a value named like a store (`store`,
// `#store`, `permissionStore`) or on the result of a factory named like one
// (`permissionStoreFor(env)`): the path argument (`read`'s first argument, the `realPath` of the
// others) must be a `permissionRoot(...)` call, awaited or not, written in the call itself. A path
// kept in a variable first is refused too. Not covered: a store held under another name, a method
// reached by `.call`/`.apply` or by destructuring (`const { read } = store`), and a
// `permissionRoot` that is not the one the backend means. It also flags any other `*Store`
// object with one of these methods; none exists in the backend. Review carries the rest.

import { calleeName } from './call-scope.utils.js';

const MESSAGE =
  "The permission store must be given `await permissionRoot({ workspace, env })`, written in the call: a repo's worktrees share one mode and allow list only when every call keys the store by the main worktree's folder. See `ConversationPermissions`.";

const STORE_METHODS = new Set(['read', 'setMode', 'allow', 'revoke']);

/**
 * The name of what the method is called on: `store`, `this.#store`, `this.permissionStore`, or the
 * factory in `permissionStoreFor(env)`.
 */
function holderName(object) {
  if (object.type === 'Identifier') return object.name;

  if (object.type === 'CallExpression') return calleeName(object);

  return object.type === 'MemberExpression' ? object.property.name : undefined;
}

function isStoreCall(node) {
  const { callee } = node;

  if (callee.type !== 'MemberExpression' || !STORE_METHODS.has(calleeName(node))) return false;

  return /store(?:for)?$/i.test(holderName(callee.object) ?? '');
}

/** The expression the call keys the store by, if it names one. */
function keyArgument(node) {
  const [first] = node.arguments;

  if (calleeName(node) === 'read') return first;

  if (first?.type !== 'ObjectExpression') return undefined;

  const property = first.properties.find(
    (entry) => entry.type === 'Property' && entry.key.name === 'realPath',
  );

  return property?.value;
}

function isPermissionRoot(expression) {
  const call = expression?.type === 'AwaitExpression' ? expression.argument : expression;

  return call?.type === 'CallExpression' && calleeName(call) === 'permissionRoot';
}

export const permissionStoreRoot = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unkeyed: MESSAGE },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isStoreCall(node) && !isPermissionRoot(keyArgument(node))) {
          context.report({ node, messageId: 'unkeyed' });
        }
      },
    };
  },
};
