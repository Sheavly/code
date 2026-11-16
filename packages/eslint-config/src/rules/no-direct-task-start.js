// Background work enters the task registry in one place: `startWork({ tasks, work })`, with a
// `WorkDefinition` a kind's factory built, so a kind's completion policy is decided by its factory
// and never by the caller. A new kind is a new factory, never a call to `TaskRegistry.start`.
//
// Type-aware: any access to the `start` member of a `TaskRegistry` (the class in
// `tasks/tasks.service.ts`, or a subclass) fails, whatever the receiver is called. That covers a
// call, an alias (`const run = tasks.start`), destructuring (`const { start } = tasks`), `.call`
// and `.apply`, `tasks['start']` and `TaskRegistry.prototype.start`; a computed key that is not a
// literal, or a rest element, on a registry fails too, since it could reach `start`. A subclass
// that overrides `start`, a nullable receiver (`tasks?.start`), a generic constrained to the
// registry, and a union or intersection with it count as registries. Tests and files under a
// `testing` folder are exempt through the shared config's `ignores`, and so is `work.utils.ts`
// next to the `tasks.service.ts` that holds `TaskRegistry` (the runtime's, the one file that
// starts work). Not covered: a registry typed `any`, `unknown` or cast to another shape (the
// `no-unsafe-*` rules and review carry that), a registry assigned to a structural type that
// re-declares `start` (an interface or `{ start(...) }`), a mixin base
// (`extends Mixin(TaskRegistry)`), `Reflect.get(tasks, 'start')`, and type-only uses
// (`typeof tasks.start`).

import { existsSync } from 'node:fs';
import path from 'node:path';

const MESSAGE =
  'Do not call `TaskRegistry.start` directly: build a `WorkDefinition` with a kind factory (`finiteWork`, `serviceWork`, or the factory of your own kind) and start it with `startWork({ tasks, work })`, so the kind decides the completion policy. A new kind of background work is a new factory: see "A kind of background work" in extending.md and sessions-and-background-work.md.';

const MEMBER = 'start';
const REGISTRY_CLASS = 'TaskRegistry';
const REGISTRY_NAME = 'tasks.service.ts';
const REGISTRY_FILE = /(^|\/)tasks\/tasks\.service\.ts$/;
const STARTER_NAME = 'work.utils.ts';

/** True if `declaration` is the `TaskRegistry` class itself. */
function isRegistryDeclaration(declaration) {
  return (
    declaration.name?.text === REGISTRY_CLASS &&
    REGISTRY_FILE.test(declaration.getSourceFile().fileName)
  );
}

/** True if `declaration` is a member of the `TaskRegistry` class. */
function isRegistryMember(declaration) {
  return declaration.parent !== undefined && isRegistryDeclaration(declaration.parent);
}

/** True if `type` is `TaskRegistry` or a class that extends it, however far up. */
function isRegistryClass(params) {
  const { type, checker } = params;
  const declarations = type.symbol?.declarations ?? [];

  if (declarations.some(isRegistryDeclaration)) return true;

  const target = type.isClassOrInterface() ? type : type.target;

  if (!target?.isClassOrInterface()) return false;

  return checker.getBaseTypes(target).some((base) => isRegistryClass({ type: base, checker }));
}

/**
 * True if `start` on `type` is `TaskRegistry`'s: the type is the class or a subclass (an override
 * included), or the member is declared by it (`Pick<TaskRegistry, 'start'>`). A null or undefined
 * part of the type is dropped, and a union or intersection counts if any part does; a type
 * parameter is read through its constraint.
 */
function isRegistryStart(params) {
  const { checker } = params;
  const type = checker.getApparentType(checker.getNonNullableType(params.type));

  if (type.isUnionOrIntersection()) {
    return type.types.some((part) => isRegistryStart({ type: part, checker }));
  }

  if (isRegistryClass({ type, checker })) return true;

  return (type.getProperty(MEMBER)?.declarations ?? []).some(isRegistryMember);
}

/** The name a key gives: its text, or `null` when it is computed and not a literal. */
function keyName(params) {
  const { key, computed } = params;

  if (key.type === 'Literal') return String(key.value);

  return computed ? null : key.name;
}

/**
 * True for the one file that starts work: `work.utils.ts` beside the `tasks.service.ts` that holds
 * `TaskRegistry`. Found from the registry's own folder, so a same-named file anywhere else, or a
 * vendored copy of the path, is not exempt.
 */
export function isStarterFile(filename) {
  return (
    path.basename(filename) === STARTER_NAME &&
    existsSync(path.join(path.dirname(filename), REGISTRY_NAME))
  );
}

/** True if a key could name `start`: it does, or it is unknown. */
function mayBeStart(name) {
  return name === MEMBER || name === null;
}

export const noDirectTaskStart = {
  meta: { type: 'problem', schema: [], messages: { direct: MESSAGE } },
  create(context) {
    const services = context.sourceCode.parserServices;

    // Without type information (plain JS) there is no type to check.
    if (!services?.program || isStarterFile(context.filename)) return {};

    const checker = services.program.getTypeChecker();
    const isRegistry = (node) =>
      isRegistryStart({
        type: checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node)),
        checker,
      });

    return {
      MemberExpression(node) {
        const name = keyName({ key: node.property, computed: node.computed });

        if (mayBeStart(name) && isRegistry(node.object)) {
          context.report({ node, messageId: 'direct' });
        }
      },
      ObjectPattern(node) {
        for (const property of node.properties) {
          const name =
            property.type === 'Property'
              ? keyName({ key: property.key, computed: property.computed })
              : null;

          if (mayBeStart(name) && isRegistry(node)) {
            context.report({ node: property, messageId: 'direct' });
          }
        }
      },
    };
  },
};
