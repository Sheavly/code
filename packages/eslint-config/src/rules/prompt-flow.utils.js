import { readFileSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { promptSourceContext, promptSourceFile } from './prompt-source.utils.js';
import { resolveSource } from './workspace-types.js';

const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'ChainExpression',
  'AwaitExpression',
]);

export function unwrapPrompt(node) {
  return node && WRAPPERS.has(node.type) ? unwrapPrompt(node.expression ?? node.argument) : node;
}

export function memberName(node) {
  return node.computed ? node.property.value : node.property.name;
}

/** Walk syntax, not parent links or type annotations. */
export function walkPrompt(node, visit) {
  if (!node || typeof node.type !== 'string') return;

  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'typeAnnotation' || key === 'loc' || key === 'range') continue;

    if (Array.isArray(value)) {
      for (const child of value) walkPrompt(child, visit);
    } else if (value && typeof value.type === 'string') {
      walkPrompt(value, visit);
    }
  }
}

function moduleOf(params) {
  const { ast, scopeManager, file } = params;
  const variables = new Map();

  for (const scope of scopeManager.scopes) {
    for (const variable of scope.variables) {
      for (const identifier of variable.identifiers) variables.set(identifier, variable);
      for (const reference of variable.references) variables.set(reference.identifier, variable);
    }
  }

  return { ast, file, variables };
}

function exportedNode(params) {
  const { module, name } = params;

  for (const statement of module.ast.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;

    const declaration = statement.declaration;

    if (declaration?.id?.name === name) return declaration;

    if (declaration?.type === 'VariableDeclaration') {
      const found = declaration.declarations.find((entry) => entry.id.name === name);

      if (found) return found.init;
    }

    const specifier = statement.specifiers.find((entry) => entry.exported.name === name);

    if (specifier) return specifier.local;
  }
}

function returnsOf(node) {
  if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
    return [node.body];
  }

  const returns = [];
  const visit = (child) => {
    if (!child) return;
    if (child !== node && /Function/.test(child.type)) return;

    if (child.type === 'ReturnStatement') {
      if (child.argument) returns.push(child.argument);

      return;
    }

    if (child.type === 'BlockStatement') child.body.forEach(visit);

    if (child.type === 'IfStatement') {
      visit(child.consequent);
      visit(child.alternate);
    }

    if (child.type === 'TryStatement') {
      visit(child.block);
      visit(child.handler?.body);
    }

    if (child.type === 'SwitchStatement') {
      for (const entry of child.cases) entry.consequent.forEach(visit);
    }
  };

  visit(node.body);

  return returns;
}

/** Bounded, scope-aware source tracing; parameters remain opaque unless a call supplies them. */
export function createPromptFlow(context) {
  const { root, workspaces } = promptSourceContext(context);
  const modules = new Map();
  const current = moduleOf({
    ast: context.sourceCode.ast,
    scopeManager: context.sourceCode.scopeManager,
    file: path.resolve(context.filename),
  });

  modules.set(current.file, current);

  const load = (file) => {
    if (!promptSourceFile({ root, file })) return;
    if (modules.has(file)) return modules.get(file);

    const parsed = tseslint.parser.parseForESLint(readFileSync(file, 'utf8'), {
      filePath: file,
      range: true,
      loc: true,
      sourceType: 'module',
    });
    const module = moduleOf({ ...parsed, file });

    modules.set(file, module);

    return module;
  };
  const sourceOf = (module, specifier) =>
    resolveSource({
      workspaces,
      from: module.file,
      specifier,
    });
  const ref = (node, module = current, env = new Map()) => ({ node, module, env });

  function importedProperty(module, source, name) {
    const file = sourceOf(module, source);

    if (file?.endsWith('.prompt.ts')) return [];

    const imported = load(file);
    const exported = imported && exportedNode({ module: imported, name });

    return exported ? [ref(exported, imported)] : [];
  }

  function binding(value) {
    const { node, module, env } = value;
    const variable = module.variables.get(node);

    if (env.has(variable)) return env.get(variable);

    const definition = variable?.defs[0];

    if (definition?.type === 'ImportBinding') {
      const source = definition.parent.source.value;
      const name = definition.node.imported?.name ?? definition.node.imported?.value;

      return importedProperty(module, source, name);
    }

    if (definition?.type === 'FunctionName') return [ref(definition.node, module, env)];
    if (definition?.type !== 'Variable' || !definition.node.init) return [];
    if (definition.node.id.type === 'Identifier') return [ref(definition.node.init, module, env)];

    const property = definition.node.id.properties?.find(
      (entry) => entry.value === definition.name,
    );

    return property ? properties(ref(definition.node.init, module, env), property.key.name) : [];
  }

  function namespaceProperty(value, name) {
    const definition = value.module.variables.get(unwrapPrompt(value.node))?.defs[0];

    if (definition?.node.type !== 'ImportNamespaceSpecifier') return;

    return importedProperty(value.module, definition.parent.source.value, name);
  }

  function properties(value, name, depth = 0) {
    if (depth > 30) return [];

    const imported = namespaceProperty(value, name);

    if (imported) return imported;

    const expanded = expand(value, depth + 1);
    const result = [];

    for (const entry of expanded) {
      if (entry.node.type !== 'ObjectExpression') continue;

      for (const property of entry.node.properties) {
        if (property.type === 'SpreadElement') {
          result.push(
            ...properties(ref(property.argument, entry.module, entry.env), name, depth + 1),
          );
        } else if ((property.key.name ?? property.key.value) === name) {
          result.push(ref(property.value, entry.module, entry.env));
        }
      }
    }

    return result;
  }

  function functionReturns(fn, arguments_) {
    if (!/Function/.test(fn.node.type)) return [];

    const callEnv = new Map(fn.env);

    fn.node.params.forEach((parameter, index) => {
      const target = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
      const argument =
        arguments_[index] ??
        (parameter.type === 'AssignmentPattern' && ref(parameter.right, fn.module, fn.env));

      if (!argument) return;

      if (target.type === 'Identifier') {
        callEnv.set(fn.module.variables.get(target), [argument]);
      } else if (target.type === 'ObjectPattern') {
        for (const property of target.properties) {
          // Rest and nested bindings remain opaque; they are not keyed scalar parameters.
          if (property.type !== 'Property' || property.value.type !== 'Identifier') continue;
          if (property.computed && property.key.type !== 'Literal') continue;

          callEnv.set(
            fn.module.variables.get(property.value),
            properties(argument, property.key.name ?? property.key.value),
          );
        }
      }
    });

    return returnsOf(fn.node).map((returned) => ref(returned, fn.module, callEnv));
  }

  function arrayMapReturns(value, depth) {
    const { node, module, env } = value;
    const callee = unwrapPrompt(node.callee);

    if (
      callee.type !== 'MemberExpression' ||
      !['map', 'flatMap'].includes(memberName(callee)) ||
      !node.arguments[0]
    ) {
      return [];
    }

    const callbacks = expand(ref(node.arguments[0], module, env), depth + 1);
    const arrays = expand(ref(callee.object, module, env), depth + 1);

    return arrays.flatMap((array) => {
      if (array.node.type !== 'ArrayExpression') return [];

      return array.node.elements
        .filter(Boolean)
        .flatMap((element) =>
          callbacks.flatMap((callback) =>
            functionReturns(callback, [ref(element, array.module, array.env)]),
          ),
        );
    });
  }

  function callReturns(value, depth) {
    const { node, module, env } = value;
    const mapped = arrayMapReturns(value, depth);

    if (mapped.length) return mapped;

    const functions = expand(ref(node.callee, module, env), depth + 1);
    const arguments_ = node.arguments.map((argument) => ref(argument, module, env));

    return functions.flatMap((fn) => functionReturns(fn, arguments_));
  }

  function expand(value, depth = 0) {
    if (!value.node || depth > 30) return [];

    const node = unwrapPrompt(value.node);
    const next = ref(node, value.module, value.env);

    if (node.type === 'Identifier') {
      return binding(next).flatMap((entry) => expand(entry, depth + 1));
    }

    if (node.type === 'MemberExpression') {
      return properties(
        ref(node.object, value.module, value.env),
        memberName(node),
        depth + 1,
      ).flatMap((entry) => expand(entry, depth + 1));
    }

    if (node.type === 'ConditionalExpression') {
      return [node.consequent, node.alternate].flatMap((entry) =>
        expand(ref(entry, value.module, value.env), depth + 1),
      );
    }

    if (node.type === 'LogicalExpression') {
      return [node.left, node.right].flatMap((entry) =>
        expand(ref(entry, value.module, value.env), depth + 1),
      );
    }

    if (node.type === 'CallExpression') {
      const returned = callReturns(next, depth + 1);

      if (returned.length) return returned.flatMap((entry) => expand(entry, depth + 1));
    }

    return [next];
  }

  function importedBinding(value, depth = 0) {
    if (depth > 30) return;

    const node = unwrapPrompt(value.node);
    const definition = value.module.variables.get(node)?.defs[0];

    if (definition?.type === 'ImportBinding') {
      return { source: definition.parent.source.value, name: definition.node.imported?.name };
    }

    if (definition?.type === 'Variable' && definition.node.init) {
      return importedBinding(ref(definition.node.init, value.module, value.env), depth + 1);
    }

    if (node?.type !== 'MemberExpression' || node.object.type !== 'Identifier') return;

    const owner = value.module.variables.get(node.object)?.defs[0];

    if (owner?.type !== 'ImportBinding') return;

    return { source: owner.parent.source.value, name: memberName(node) };
  }

  return { current, ref, expand, properties, importedBinding, sourceOf, workspaces };
}
