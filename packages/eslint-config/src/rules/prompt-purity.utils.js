import { unwrapPromptExpression } from './prompt-shape.utils.js';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const GLOBAL_EFFECTS = new Set([
  'process',
  'console',
  'fetch',
  'globalThis',
  'global',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'caches',
  'Deno',
  'Bun',
  'require',
  'eval',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'Date',
  'performance',
  'crypto',
]);
const EFFECT_CALLS = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'generateText',
  'generateObject',
  'streamText',
  'streamObject',
  'generateContent',
  'generateContentStream',
  'invoke',
  'sendMessage',
  'sendMessageStream',
]);
const MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);
const PURE_CONSTRUCTORS = new Set(['Map', 'Set', 'RegExp', 'URL', 'TextEncoder', 'TextDecoder']);
const COPY_METHODS = new Set([
  'map',
  'filter',
  'slice',
  'split',
  'concat',
  'flat',
  'flatMap',
  'toSorted',
  'toReversed',
  'with',
]);

function propertyName(member) {
  return member.computed ? member.property.value : (member.property.name ?? member.property.value);
}

function enclosingFunction(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (FUNCTIONS.has(parent.type)) return parent;
  }

  return undefined;
}

function variableFor(params) {
  const { sourceCode, node } = params;

  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);

    if (variable) return variable;
  }

  return undefined;
}

function isRuntimeReference(params) {
  const { sourceCode, node } = params;
  const scope = sourceCode.getScope(node);
  const reference = [...scope.references, ...scope.through].find(
    (entry) => entry.identifier === node,
  );

  return reference && !reference.isTypeReference;
}

function bindingPath(pattern, identifier) {
  if (pattern === identifier) return [];

  const entries = pattern.type === 'ObjectPattern' ? pattern.properties : pattern.elements;

  if (!entries) return undefined;

  for (const [index, entry] of entries.entries()) {
    if (!entry || entry.type === 'RestElement') continue;

    const objectPattern = pattern.type === 'ObjectPattern';
    const child = objectPattern ? entry.value : entry;
    const path = bindingPath(child, identifier);

    if (!path) continue;

    const key = objectPattern ? propertyName({ ...entry, property: entry.key }) : index;

    if (key !== undefined) return [String(key), ...path];
  }

  return undefined;
}

function arrayProperty(params) {
  const { node, path } = params;
  const [key, ...rest] = path;
  const index = Number(key);

  if (!Number.isInteger(index) || index < 0) return undefined;

  if (node.elements.slice(0, index + 1).some((entry) => entry?.type === 'SpreadElement')) {
    return undefined;
  }

  return { node: node.elements[index], path: rest };
}

function literalProperty(params) {
  const { node, path } = params;
  const [key, ...rest] = path;

  if (node.type === 'ArrayExpression') return arrayProperty(params);
  if (node.type !== 'ObjectExpression') return undefined;

  for (const entry of [...node.properties].reverse()) {
    if (entry.type === 'SpreadElement') return { node: entry.argument, path };

    const name = propertyName({ ...entry, property: entry.key });

    // Unknown computed keys may overwrite the requested property; getters are not owned values.
    if (name === undefined) return undefined;

    if (String(name) === key) {
      return entry.kind === 'init' ? { node: entry.value, path: rest } : undefined;
    }
  }

  return undefined;
}

function localInitializer(params) {
  const { sourceCode, node, owner, seen, path } = params;
  const variable = variableFor({ sourceCode, node });
  const definition = variable?.defs[0];

  if (seen.has(variable) || definition?.type !== 'Variable') return undefined;
  if (!owner || enclosingFunction(definition.node) !== owner) return undefined;

  const binding = bindingPath(definition.node.id, definition.name);

  if (!binding) return undefined;

  return {
    node: definition.node.init,
    path: [...binding, ...path],
    seen: new Set(seen).add(variable),
  };
}

function resolveLocalValue(params) {
  const { sourceCode, owner, seen = new Set(), path = [], depth = 0 } = params;
  const node = unwrapPromptExpression(params.node);

  if (!node || depth > 32) return undefined;

  let next;

  if (node.type === 'Identifier') {
    next = localInitializer({ sourceCode, node, owner, seen, path });
  } else if (node.type === 'MemberExpression') {
    const key = propertyName(node);

    if (key !== undefined) next = { node: node.object, path: [String(key), ...path] };
  } else if (path.length) {
    next = literalProperty({ node, path });
  } else {
    const callee = node.type === 'CallExpression' && unwrapPromptExpression(node.callee);
    const assignsObject =
      callee?.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Object' &&
      propertyName(callee) === 'assign';

    if (!assignsObject) return node;

    next = { node: node.arguments[0], path: [] };
  }

  if (!next) return undefined;

  return resolveLocalValue({ sourceCode, owner, seen, ...next, depth: depth + 1 });
}

/** Only the actual per-call receiver is fresh; shallow copies do not own their children. */
function isFreshLocal(params) {
  const { sourceCode, node } = params;
  const value = resolveLocalValue({ sourceCode, node, owner: enclosingFunction(node) });

  if (!value) return false;
  if (['ArrayExpression', 'ObjectExpression'].includes(value.type)) return true;

  if (value.type === 'NewExpression') {
    return value.callee.type === 'Identifier' && PURE_CONSTRUCTORS.has(value.callee.name);
  }

  return (
    value.type === 'CallExpression' &&
    value.callee.type === 'MemberExpression' &&
    COPY_METHODS.has(propertyName(value.callee))
  );
}

function isLocalAssignment(params) {
  const { sourceCode, node } = params;
  const value = unwrapPromptExpression(node);

  if (value?.type === 'MemberExpression') {
    return isFreshLocal({ sourceCode, node: value.object });
  }

  if (value?.type !== 'Identifier') return false;

  const definition = variableFor({ sourceCode, node: value })?.defs[0];

  return definition?.type === 'Variable' && Boolean(enclosingFunction(definition.node));
}

function callHasEffect(node) {
  const callee = unwrapPromptExpression(node.callee);

  if (callee.type === 'Identifier') return EFFECT_CALLS.has(callee.name);
  if (callee.type !== 'MemberExpression') return false;

  const method = propertyName(callee);
  const receiver = callee.object;

  if (EFFECT_CALLS.has(method)) return true;

  if (receiver.type === 'Identifier' && receiver.name === 'Math' && method === 'random') {
    return true;
  }

  let receiverName;

  if (receiver.type === 'Identifier') receiverName = receiver.name;
  if (receiver.type === 'MemberExpression') receiverName = propertyName(receiver);

  return (
    ['create', 'stream', 'generate', 'complete'].includes(method) &&
    ['provider', 'model', 'responses', 'completions', 'messages', 'models'].includes(receiverName)
  );
}

/** A mechanical effect boundary, not a proof that arbitrary imported/callback code is pure. */
export function promptPurityVisitors(context) {
  const { sourceCode } = context;
  const report = (node) => context.report({ node, messageId: 'promptEffect' });
  const checkMutation = (node, target) => {
    if (!isLocalAssignment({ sourceCode, node: target })) report(node);
  };

  return {
    Identifier(node) {
      if (!GLOBAL_EFFECTS.has(node.name) || !isRuntimeReference({ sourceCode, node })) return;
      if (variableFor({ sourceCode, node })?.defs.length) return;

      report(node);
    },
    MemberExpression(node) {
      if (node.object.type === 'MetaProperty' && propertyName(node) === 'env') report(node);
    },
    VariableDeclaration(node) {
      if (node.kind !== 'const' && !enclosingFunction(node)) report(node);
    },
    ExpressionStatement(node) {
      if (!enclosingFunction(node) && !node.directive) report(node);
    },
    NewExpression(node) {
      if (node.callee.type !== 'Identifier' || !PURE_CONSTRUCTORS.has(node.callee.name)) {
        report(node);
      }
    },
    CallExpression(node) {
      if (callHasEffect(node)) report(node);

      const callee = unwrapPromptExpression(node.callee);

      if (callee.type !== 'MemberExpression') return;

      const method = propertyName(callee);
      const receiver = callee.object;
      const staticMutation =
        receiver.type === 'Identifier' &&
        ['Object', 'Reflect'].includes(receiver.name) &&
        [
          'assign',
          'defineProperty',
          'defineProperties',
          'setPrototypeOf',
          'set',
          'deleteProperty',
        ].includes(method);

      if (staticMutation) {
        if (!isFreshLocal({ sourceCode, node: node.arguments[0] })) report(node);

        return;
      }

      if (MUTATORS.has(method) && !isFreshLocal({ sourceCode, node: receiver })) report(node);
    },
    AssignmentExpression: (node) => checkMutation(node, node.left),
    UpdateExpression: (node) => checkMutation(node, node.argument),
    UnaryExpression(node) {
      if (node.operator === 'delete') checkMutation(node, node.argument);
    },
    AwaitExpression: report,
    YieldExpression: report,
    ImportExpression: report,
  };
}

/** Prompt imports may depend on pure code/data, never runtime effects or model SDKs. */
export function isImpurePromptSource(source) {
  return /^(?:node:)?(?:fs|child_process|net|http|https|os|readline|tty|worker_threads|process|console|crypto|http2|tls|dgram|dns|stream|events|timers|module|perf_hooks)(?:\/|$)|^(?:zod(?:\/|$)|openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai|@ai-sdk\/|ai$)|(?:^|\/)providers(?:\/|$)|\.(?:service|helper|tool|adapter|fake|validator)(?:\.(?:js|mjs|ts|tsx))?$/.test(
    source,
  );
}
