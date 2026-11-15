// Ids are branded, so a session's id can't be passed where a tool call's goes. Two checks:
// - zod: a property named `id` or `<x>Id` (`callId`, `sessionId`) in any source file's zod schema
//   whose value is a bare `z.string()` chain fails, and so does an id schema (`<x>IdSchema`)
//   built without `.brand<'…'>()`.
// - TypeScript: a type member (type literal, interface, inline parameter type) with such a name
//   typed `string` (or `string | undefined`) fails; type it with the id's branded type
//   (`SessionId`). The config applies this to source only: never tests, fakes or `*.prompt.ts`
//   (text a prompt prints). Every workspace is covered. Only type members are checked: a plain
//   function parameter, a class field, `id: string[]` and a `type X = string` alias are not, and
//   neither is a name such as `ids`; review carries those.
// Branding is type-only: the value and its JSON Schema stay a plain string.

const ID_KEY = /^(id|[a-z]\w*Id)$/;
const ID_SCHEMA = /IdSchema$/;

const SCHEMAS =
  '`sessionIdSchema`, `callIdSchema`, `taskIdSchema`, `approvalIdSchema`, `conversationIdSchema`, `modelIdSchema`, `profileIdSchema`, `messageIdSchema`, `outputRefSchema`, `summarySectionIdSchema` from @sheavly/protocol';

const MESSAGES = {
  unbranded: `\`{{name}}\` is an id: use a branded id schema (${SCHEMAS}), or define one in a validator, \`export const <x>IdSchema = z.string().brand<'<X>Id'>();\`, with its type \`z.infer\` of it in the module's types file.`,
  unbrandedType: `\`{{name}}: string\` is an id typed as a bare string: use the branded type of its schema (\`SessionId\`, \`CallId\`, \`TaskId\`, … from the protocol's *.types files, made by parsing with ${SCHEMAS}), or define a branded id schema for this kind.`,
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

/** True for `string` and for a union with `string` in it (`string | undefined`). */
function isBareString(typeNode) {
  if (typeNode.type === 'TSStringKeyword') return true;

  return typeNode.type === 'TSUnionType' && typeNode.types.some(isBareString);
}

export const brandedIds = {
  meta: {
    type: 'problem',
    schema: [
      { type: 'object', properties: { types: { type: 'boolean' } }, additionalProperties: false },
    ],
    messages: MESSAGES,
  },
  create(context) {
    // `{ types: false }` keeps the zod checks and skips type members (a prompt file).
    const checkTypes = context.options[0]?.types !== false;

    return {
      TSPropertySignature(node) {
        if (!checkTypes) return;

        const name = keyName(node);
        const annotation = node.typeAnnotation?.typeAnnotation;

        if (
          typeof name === 'string' &&
          ID_KEY.test(name) &&
          annotation &&
          isBareString(annotation)
        ) {
          context.report({ node: annotation, messageId: 'unbrandedType', data: { name } });
        }
      },
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
