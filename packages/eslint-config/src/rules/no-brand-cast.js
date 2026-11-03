// A branded value (a zod `.brand<'…'>()` type, `SessionId`) is made by parsing with its schema,
// never asserted: `'s1' as SessionId` would brand anything, which is what the brand rules out.
// Type-aware: any `as` whose target type carries zod's `$brand` fails, in source and tests alike.

const MESSAGE =
  "Don't assert a branded type (`as {{type}}`): parse it with its schema (`sessionIdSchema.parse(id)`), which is what makes a value one. A test with a plain string id does the same (or uses `toolRunner` / `toolCall`, which brand it).";

/** True if `type`, or one member of its union, has zod's `$brand` symbol property. */
function isBranded(type) {
  if (type.isUnion()) return type.types.some(isBranded);

  return type.getProperties().some((property) => property.escapedName.startsWith('__@$brand'));
}

export const noBrandCast = {
  meta: { type: 'problem', schema: [], messages: { cast: MESSAGE } },
  create(context) {
    const services = context.sourceCode.parserServices;

    // Without type information (plain JS) there is no type to check.
    if (!services?.program) return {};

    const checker = services.program.getTypeChecker();

    return {
      TSAsExpression(node) {
        const type = checker.getTypeFromTypeNode(
          services.esTreeNodeToTSNodeMap.get(node.typeAnnotation),
        );

        if (isBranded(type)) {
          context.report({
            node,
            messageId: 'cast',
            data: { type: context.sourceCode.getText(node.typeAnnotation) },
          });
        }
      },
    };
  },
};
