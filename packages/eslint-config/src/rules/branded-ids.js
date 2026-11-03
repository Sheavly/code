// Ids in a schema are branded, so a session's id can't be passed where a tool call's goes. A
// property named `id` or `<x>Id` (`callId`, `sessionId`) in a validator or a tool's input schema
// whose value is a bare `z.string()` chain fails, and so does an id schema (`<x>IdSchema`) built
// without `.brand<'…'>()`. Branding is type-only: the value and its JSON Schema stay a plain string.

const ID_KEY = /^(id|[a-z]\w*Id)$/;
const ID_SCHEMA = /IdSchema$/;

const MESSAGES = {
  unbranded:
    "`{{name}}` is an id: use a branded id schema (`sessionIdSchema`, `callIdSchema`, `taskIdSchema`, `approvalIdSchema` from @sheavly/protocol), or define one in a validator, `export const <x>IdSchema = z.string().brand<'<X>Id'>();`, with its type `z.infer` of it in the module's types file.",
  unbrandedSchema:
    "`{{name}}` is an id schema: brand it, `z.string().brand<'<X>Id'>()`, so its ids can't be mixed up with another kind's.",
};

/** The methods of a zod chain rooted at `z` (`z.string().min(1)` → `['string', 'min']`), else undefined. */
function zodChain(node) {
  const methods = [];
  let current = node;

  while (current?.type === 'CallExpression' && current.callee.type === 'MemberExpression') {
    methods.unshift(current.callee.property.name);
    current = current.callee.object;
  }

  return current?.type === 'Identifier' && current.name === 'z' ? methods : undefined;
}

/** True for `z.string()…` without `.brand()`. */
function isUnbrandedString(node) {
  const methods = zodChain(node);

  return methods?.[0] === 'string' && !methods.includes('brand');
}

function keyName(node) {
  if (node.computed) return undefined;

  return node.key.type === 'Identifier' ? node.key.name : node.key.value;
}

export const brandedIds = {
  meta: { type: 'problem', schema: [], messages: MESSAGES },
  create(context) {
    return {
      Property(node) {
        const name = keyName(node);

        if (typeof name === 'string' && ID_KEY.test(name) && isUnbrandedString(node.value)) {
          context.report({ node: node.value, messageId: 'unbranded', data: { name } });
        }
      },
      VariableDeclarator(node) {
        const { id, init } = node;

        if (id.type === 'Identifier' && ID_SCHEMA.test(id.name) && isUnbrandedString(init)) {
          context.report({ node: init, messageId: 'unbrandedSchema', data: { name: id.name } });
        }
      },
    };
  },
};
