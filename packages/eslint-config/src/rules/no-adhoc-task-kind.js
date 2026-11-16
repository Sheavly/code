// What a kind of background work means for a run (held open for, grouped, awaited, waking an idle
// session) is decided once, by `isFiniteKind` in the runtime's `work.utils.ts`, so a new kind
// joins the finite machine through one definition. A policy site that compares the kind itself
// (`kind === 'service'`) is a second definition that drifts: a fake that compared to `'task'` was
// never given the `agent` kind.
//
// Type-aware, by the type's shape and not its name (the protocol's `TaskKind` is `z.infer` of a
// schema, so its alias name is not reliable): a comparison (`===`, `!==`, `==`, `!=`, either side)
// or a `switch` on a value whose type is a union of two or more of `'task'`, `'agent'` and
// `'service'` fails, `undefined` and `null` dropped from the type. So an unrelated type that is
// also a union of those literals fails too: use `TaskKind` there. A comparison with `undefined` or
// `null` (is a kind present?) is not a policy and passes. Not applied to apps (a UI counts
// commands, agents and services apart to show them, which is presentation, not policy), nor to
// tests and fakes, through the shared config. The one exempt source file is the runtime's
// `work.utils.ts` beside its `tasks.service.ts`, where `isFiniteKind` lives. Not covered: a kind
// widened to `string` or `any` first, a lookup (`Set.has`, `includes`, a record indexed by the
// kind), a type of only one literal (a kind already narrowed to it), and a union that mixes in
// another literal; review carries those.

import { isStarterFile } from './no-direct-task-start.js';

const KINDS = new Set(['task', 'agent', 'service']);
const OPERATORS = new Set(['===', '!==', '==', '!=']);

const MESSAGE =
  'Do not compare a task kind by hand: ask `isFiniteKind(kind)` (`@sheavly/runtime/tasks/work.utils`), the one definition of which kinds are finite, so a new kind joins the finite machine there and nowhere else. An app that shows kinds apart may compare them; a policy may not.';

/** True if `type` is a union of at least two of the kind literals. */
function isTaskKind(params) {
  const { checker } = params;
  const type = checker.getNonNullableType(params.type);

  if (!type.isUnion()) return false;

  const { types } = type;

  return (
    types.length >= 2 && types.every((part) => part.isStringLiteral() && KINDS.has(part.value))
  );
}

/** True for `x === undefined`, `x !== null` and the like: whether a kind is there, not which. */
function isPresenceCheck(node) {
  const empty = (side) =>
    (side.type === 'Identifier' && side.name === 'undefined') ||
    (side.type === 'Literal' && side.value === null && side.raw === 'null');

  return empty(node.left) || empty(node.right);
}

export const noAdhocTaskKind = {
  meta: { type: 'problem', schema: [], messages: { adhoc: MESSAGE } },
  create(context) {
    const services = context.sourceCode.parserServices;

    // Without type information (plain JS) there is no type to check.
    if (!services?.program || isStarterFile(context.filename)) return {};

    const checker = services.program.getTypeChecker();
    const isKind = (node) =>
      isTaskKind({
        type: checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node)),
        checker,
      });

    return {
      BinaryExpression(node) {
        if (isPresenceCheck(node)) return;

        if (OPERATORS.has(node.operator) && (isKind(node.left) || isKind(node.right))) {
          context.report({ node, messageId: 'adhoc' });
        }
      },
      SwitchStatement(node) {
        if (isKind(node.discriminant)) {
          context.report({ node: node.discriminant, messageId: 'adhoc' });
        }
      },
    };
  },
};
